import { existsSync } from "fs";
import { writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { initConfig, initDir, _getEnv } from "./utils";
import { createServer } from "./server";
import { apiKeyAuth } from "./middleware/auth";
import { CONFIG_FILE, HOME_DIR, listPresets } from "@CCR/shared";
import { createStream } from 'rotating-file-stream';
import { sessionUsageCache } from "@musistudio/llms";
import { SSEParserTransform } from "./utils/SSEParser.transform";
import { SSESerializerTransform } from "./utils/SSESerializer.transform";
import { rewriteStream } from "./utils/rewriteStream";
import { recordRoutingEvent } from "./utils/history";
import { startHealthChecks, stopHealthChecks } from "./utils/health";
import { updateQuotaFromHeaders, writeProviderStatusFile, writeHudProviderStats } from "./utils/quota";
import JSON5 from "json5";
import { IAgent, ITool } from "./agents/type";
import agentsManager from "./agents";
import { EventEmitter } from "node:events";
import { AsyncLocalStorage } from "node:async_hooks";
import { pluginManager, tokenSpeedPlugin } from "@musistudio/llms";

const event = new EventEmitter()
const upstreamRequestStorage = new AsyncLocalStorage<any>();
let upstreamFetchCaptureInstalled = false;

function installUpstreamFetchCapture(): void {
  if (upstreamFetchCaptureInstalled) {
    return;
  }

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const response = await originalFetch(...args);
    const trackedRequest = upstreamRequestStorage.getStore();

    if (trackedRequest?.pathname?.endsWith("/v1/messages")) {
      trackedRequest._upstreamHeaders = new Headers(response.headers);
    }

    return response;
  }) as typeof fetch;

  upstreamFetchCaptureInstalled = true;
}

async function initializeClaudeConfig() {
  const homeDir = homedir();
  const configPath = join(homeDir, ".claude.json");
  if (!existsSync(configPath)) {
    const userID = Array.from(
      { length: 64 },
      () => Math.random().toString(16)[2]
    ).join("");
    const configContent = {
      numStartups: 184,
      autoUpdaterStatus: "enabled",
      userID,
      hasCompletedOnboarding: true,
      lastOnboardingVersion: "1.0.17",
      projects: {},
    };
    await writeFile(configPath, JSON.stringify(configContent, null, 2));
  }
}

interface RunOptions {
  port?: number;
  logger?: any;
}

/**
 * Plugin configuration from config file
 */
interface PluginConfig {
  name: string;
  enabled?: boolean;
  options?: Record<string, any>;
}

/**
 * Register plugins from configuration
 * @param serverInstance Server instance
 * @param config Application configuration
 */
async function registerPluginsFromConfig(serverInstance: any, config: any): Promise<void> {
  // Get plugins configuration from config file
  const pluginsConfig: PluginConfig[] = config.plugins || config.Plugins || [];

  for (const pluginConfig of pluginsConfig) {
      const { name, enabled = false, options = {} } = pluginConfig;

      switch (name) {
        case 'token-speed':
          pluginManager.registerPlugin(tokenSpeedPlugin, {
            enabled,
            outputHandlers: [
              {
                type: 'temp-file',
                enabled: true
              }
            ],
            ...options
          });
          break;

        default:
          console.warn(`Unknown plugin: ${name}`);
          break;
      }
    }
  // Enable all registered plugins
  await pluginManager.enablePlugins(serverInstance);
}

async function getServer(options: RunOptions = {}) {
  await initializeClaudeConfig();
  await initDir();
  installUpstreamFetchCapture();
  const config = await initConfig();

  // Check if Providers is configured
  const providers = config.Providers || config.providers || [];
  const hasProviders = providers && providers.length > 0;

  let HOST = config.HOST || "127.0.0.1";

  if (hasProviders) {
    HOST = config.HOST;
    if (!config.APIKEY) {
      HOST = "127.0.0.1";
    }
  } else {
    // When no providers are configured, listen on 0.0.0.0 without authentication
    HOST = "0.0.0.0";
    console.log("ℹ️  No providers configured. Listening on 0.0.0.0 without authentication.");
  }

  const port = config.PORT || 3456;

  // Use port from environment variable if set (for background process)
  const servicePort = _getEnv('SERVICE_PORT')
    ? parseInt(_getEnv('SERVICE_PORT')!)
    : port;

  // Configure logger based on config settings or external options
  const pad = (num: number) => (num > 9 ? "" : "0") + num;
  const generator = (time: number | Date | undefined, index: number | undefined) => {
    let date: Date;
    if (!time) {
      date = new Date();
    } else if (typeof time === 'number') {
      date = new Date(time);
    } else {
      date = time;
    }

    const month = date.getFullYear() + "" + pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hour = pad(date.getHours());
    const minute = pad(date.getMinutes());

    return `./logs/ccr-${month}${day}${hour}${minute}${pad(date.getSeconds())}${index ? `_${index}` : ''}.log`;
  };

  let loggerConfig: any;

  // Use external logger configuration if provided
  if (options.logger !== undefined) {
    loggerConfig = options.logger;
  } else {
    // Enable logger if not provided and config.LOG !== false
    if (config.LOG !== false) {
      // Set config.LOG to true (if not already set)
      if (config.LOG === undefined) {
        config.LOG = true;
      }
      loggerConfig = {
        level: config.LOG_LEVEL || "debug",
        stream: createStream(generator, {
          path: HOME_DIR,
          maxFiles: 3,
          interval: "1d",
          compress: false,
          maxSize: "50M"
        }),
      };
    } else {
      loggerConfig = false;
    }
  }

  const presets = await listPresets();

  const serverInstance = await createServer({
    jsonPath: CONFIG_FILE,
    initialConfig: {
      // ...config,
      providers: config.Providers || config.providers,
      HOST: HOST,
      PORT: servicePort,
      LOG_FILE: join(
        homedir(),
        ".claude-code-router",
        "claude-code-router.log"
      ),
    },
    logger: loggerConfig,
  });

  await Promise.allSettled(
      presets.map(async preset => await serverInstance.registerNamespace(`/preset/${preset.name}`, preset.config))
  )

  // Register and configure plugins from config
  await registerPluginsFromConfig(serverInstance, config);

  serverInstance.addHook("onRequest", async (req: any) => {
    upstreamRequestStorage.enterWith(req);
  });

  // Add async preHandler hook for authentication
  serverInstance.addHook("preHandler", async (req: any, reply: any) => {
    return new Promise<void>((resolve, reject) => {
      const done = (err?: Error) => {
        if (err) reject(err);
        else resolve();
      };
      // Call the async auth function
      apiKeyAuth(config)(req, reply, done).catch(reject);
    });
  });
  serverInstance.addHook("preHandler", async (req: any, reply: any) => {
    const url = new URL(`http://127.0.0.1${req.url}`);
    req.pathname = url.pathname;
    if (req.pathname.endsWith("/v1/messages") && req.pathname !== "/v1/messages") {
      req.preset = req.pathname.replace("/v1/messages", "").replace("/", "");
    }
  })

  serverInstance.addHook("preHandler", async (req: any, reply: any) => {
    if (req.pathname.endsWith("/v1/messages")) {
      req._routingStartTime = Date.now();
      const useAgents = []

      for (const agent of agentsManager.getAllAgents()) {
        if (agent.shouldHandle(req, config)) {
          // Set agent identifier
          useAgents.push(agent.name)

          // change request body
          agent.reqHandler(req, config);

          // append agent tools
          if (agent.tools.size) {
            if (!req.body?.tools?.length) {
              req.body.tools = []
            }
            req.body.tools.unshift(...Array.from(agent.tools.values()).map(item => {
              return {
                name: item.name,
                description: item.description,
                input_schema: item.input_schema
              }
            }))
          }
        }
      }

      if (useAgents.length) {
        req.agents = useAgents;
      }
    }
  });
  serverInstance.addHook("onError", async (request: any, reply: any, error: any) => {
    event.emit('onError', request, reply, error);
  })
  serverInstance.addHook("onSend", (req: any, reply: any, payload: any, done: any) => {
    if (req.sessionId && req.pathname?.endsWith("/v1/messages")) {
      const latencyMs = req._routingStartTime ? Date.now() - req._routingStartTime : 0;
      const model = typeof req.body?.model === "string" ? req.body.model : "";
      const providerName =
        typeof req.provider === "string" && req.provider
          ? req.provider
          : model.includes(",")
            ? model.split(",")[0]
            : "unknown";
      const modelName = model.includes(",") ? model.split(",").slice(1).join(",") : model;
      const scenarioType = req.scenarioType || 'default';

      if (providerName !== "unknown" && req._upstreamHeaders instanceof Headers) {
        updateQuotaFromHeaders(providerName, req._upstreamHeaders).catch((error) => {
          console.error("Failed to update provider quota:", error);
        });
      }

      const recordEvent = (status: 'success' | 'error', errorMessage?: string) => {
        const usage = sessionUsageCache.get(req.sessionId) || { input_tokens: 0, output_tokens: 0 };
        recordRoutingEvent({
          sessionId: req.sessionId,
          timestamp: new Date().toISOString(),
          provider: providerName || 'unknown',
          model: modelName || model || 'unknown',
          scenarioType,
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          latencyMs,
          status,
          errorMessage,
        }).catch((err) => console.error('Failed to record routing event:', err));

        const activeProvider = providerName !== 'unknown' ? providerName : undefined;
        writeProviderStatusFile(activeProvider).catch(() => {});
        writeHudProviderStats(req.sessionId, activeProvider).catch(() => {});
      };

      if (payload instanceof ReadableStream) {
        const [originalStream, clonedStream] = payload.tee();
        const read = async (stream: ReadableStream) => {
          const reader = stream.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const dataStr = new TextDecoder().decode(value);
              if (!dataStr.startsWith("event: message_delta")) {
                continue;
              }
              const str = dataStr.slice(27);
              try {
                const message = JSON.parse(str);
                sessionUsageCache.put(req.sessionId, message.usage);
              } catch {}
            }
          } catch (readError: any) {
            if (readError.name === 'AbortError' || readError.code === 'ERR_STREAM_PREMATURE_CLOSE') {
              console.error('Background read stream closed prematurely');
            } else {
              console.error('Error in background stream reading:', readError);
            }
          } finally {
            reader.releaseLock();
          }
        }
        read(clonedStream);
        recordEvent('success');

        return done(null, originalStream)
      }
      sessionUsageCache.put(req.sessionId, payload.usage);
      if (typeof payload ==='object') {
        if (payload.error) {
          recordEvent('error', payload.error.message || String(payload.error));
          return done(payload.error, null)
        } else {
          recordEvent('success');

          return done(payload, null)
        }
      }
    }
    if (typeof payload ==='object' && payload.error) {
      return done(payload.error, null)
    }
    done(null, payload)
  });
  serverInstance.addHook("onSend", async (req: any, reply: any, payload: any) => {
    event.emit('onSend', req, reply, payload);
    return payload;
  });

  // Add global error handlers to prevent the service from crashing
  process.on("uncaughtException", (err) => {
    serverInstance.app.log.error("Uncaught exception:", err);
  });

  process.on("unhandledRejection", (reason, promise) => {
    serverInstance.app.log.error("Unhandled rejection at:", promise, "reason:", reason);
  });

  startHealthChecks(providers);

  return serverInstance;
}

async function run() {
  const server = await getServer();
  server.app.post("/api/restart", async () => {
    stopHealthChecks();
    setTimeout(async () => {
      process.exit(0);
    }, 100);

    return { success: true, message: "Service restart initiated" }
  });
  await server.start();
}

export { getServer };
export type { RunOptions };
export type { IAgent, ITool } from "./agents/type";
export { initDir, initConfig, readConfigFile, writeConfigFile, backupConfigFile } from "./utils";
export { pluginManager, tokenSpeedPlugin } from "@musistudio/llms";

// Start service if this file is run directly
if (require.main === module) {
  run().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}
