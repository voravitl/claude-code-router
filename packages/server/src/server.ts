import Server, { calculateTokenCount, TokenizerService } from "@musistudio/llms";
import { readConfigFile, writeConfigFile, backupConfigFile } from "./utils";
import { join } from "path";
import fastifyStatic from "@fastify/static";
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, rmSync } from "fs";
import { homedir } from "os";
import {
  getPresetDir,
  readManifestFromDir,
  manifestToPresetFile,
  saveManifest,
  isPresetInstalled,
  extractPreset,
  HOME_DIR,
  extractMetadata,
  loadConfigFromManifest,
  downloadPresetToTemp,
  getTempDir,
  findMarketPresetByName,
  getMarketPresets,
  type PresetFile,
  type ManifestFile,
  type PresetMetadata,
} from "@CCR/shared";
import fastifyMultipart from "@fastify/multipart";
import AdmZip from "adm-zip";
import { getRoutingHistory, getRoutingStats, clearRoutingHistory } from "./utils/history";
import { getProviderHealth } from "./utils/health";
import { getProviderQuota, getProviderQuotas } from "./utils/quota";

type ProviderRecord = {
  name: string;
  api_base_url: string;
  api_key: string;
  models: string[];
  transformer?: {
    use?: unknown[];
  };
  [key: string]: unknown;
};

type ConfigWithProviders = {
  Providers?: ProviderRecord[];
  [key: string]: unknown;
};

function isProviderRecord(value: unknown): value is ProviderRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ProviderRecord>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.api_base_url === "string" &&
    typeof candidate.api_key === "string" &&
    Array.isArray(candidate.models) &&
    candidate.models.every((model) => typeof model === "string")
  );
}

function parseProviderIndex(indexValue: string): number | null {
  const parsedIndex = Number.parseInt(indexValue, 10);
  return Number.isInteger(parsedIndex) && parsedIndex >= 0 ? parsedIndex : null;
}

function isAnthropicProvider(provider: ProviderRecord): boolean {
  if (provider.api_base_url.includes("anthropic.com/v1/messages")) {
    return true;
  }

  return provider.transformer?.use?.some(
    (entry) => typeof entry === "string" && entry === "anthropic"
  ) ?? false;
}

function hasProviderApiKey(provider: ProviderRecord): boolean {
  const trimmedApiKey = provider.api_key.trim();
  return trimmedApiKey.length > 0 && trimmedApiKey.toLowerCase() !== "none";
}

function buildProviderTestRequest(provider: ProviderRecord): {
  body: Record<string, unknown>;
  headers: Record<string, string>;
} {
  const model = provider.models[0];
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (hasProviderApiKey(provider)) {
    if (isAnthropicProvider(provider)) {
      headers["x-api-key"] = provider.api_key;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers.Authorization = `Bearer ${provider.api_key}`;
    }
  }

  if (isAnthropicProvider(provider)) {
    return {
      headers,
      body: {
        model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      },
    };
  }

  return {
    headers,
    body: {
      model,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
      stream: false,
    },
  };
}

export const createServer = async (config: any): Promise<any> => {
  const server = new Server(config);
  const app = server.app;

  app.register(fastifyMultipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
    },
  });

  app.post("/v1/messages/count_tokens", async (req: any, reply: any) => {
    const {messages, tools, system, model} = req.body;
    const tokenizerService = (app as any)._server!.tokenizerService as TokenizerService;

    // If model is specified in "providerName,modelName" format, use the configured tokenizer
    if (model && model.includes(",") && tokenizerService) {
      try {
        const [provider, modelName] = model.split(",");
        req.log?.info(`Looking up tokenizer for provider: ${provider}, model: ${modelName}`);

        const tokenizerConfig = tokenizerService.getTokenizerConfigForModel(provider, modelName);

        if (!tokenizerConfig) {
          req.log?.warn(`No tokenizer config found for ${provider},${modelName}, using default tiktoken`);
        } else {
          req.log?.info(`Using tokenizer config: ${JSON.stringify(tokenizerConfig)}`);
        }

        const result = await tokenizerService.countTokens(
          { messages, system, tools },
          tokenizerConfig
        );

        return {
          "input_tokens": result.tokenCount,
          "tokenizer": result.tokenizerUsed,
        };
      } catch (error: any) {
        req.log?.error(`Error using configured tokenizer: ${error.message}`);
        req.log?.error(error.stack);
        // Fall back to default calculation
      }
    } else {
      if (!model) {
        req.log?.info(`No model specified, using default tiktoken`);
      } else if (!model.includes(",")) {
        req.log?.info(`Model "${model}" does not contain comma, using default tiktoken`);
      } else if (!tokenizerService) {
        req.log?.warn(`TokenizerService not available, using default tiktoken`);
      }
    }

    // Default to tiktoken calculation
    const tokenCount = calculateTokenCount(messages, system, tools);
    return { "input_tokens": tokenCount }
  });

  // Add endpoint to read config.json with access control
  app.get("/api/config", async (req: any, reply: any) => {
    return await readConfigFile();
  });

  app.get("/api/transformers", async (req: any, reply: any) => {
    const transformers =
      (app as any)._server!.transformerService.getAllTransformers();
    const transformerList = Array.from(transformers.entries()).map(
      ([name, transformer]: any) => ({
        name,
        endpoint: transformer.endPoint || null,
      })
    );
    return { transformers: transformerList };
  });

  // Analytics: Get routing history
  app.get("/api/routing/history", async (req: any, reply: any) => {
    const limit = parseInt(req.query.limit || "50", 10);
    const offset = parseInt(req.query.offset || "0", 10);
    return await getRoutingHistory(limit, offset);
  });

  // Analytics: Get routing stats
  app.get("/api/routing/stats", async (req: any, reply: any) => {
    return await getRoutingStats();
  });

  // Analytics: Clear routing history
  app.delete("/api/routing/history", async (req: any, reply: any) => {
    await clearRoutingHistory();
    return { success: true, message: "Routing history cleared" };
  });

  // Health: Get provider health
  app.get("/api/health/providers", async (req: any, reply: any) => {
    return getProviderHealth();
  });

  // Providers: Quotas
  app.get("/api/providers/quotas", async () => {
    return getProviderQuotas();
  });

  app.get(
    "/api/providers/:name/quota",
    async (req: any, reply: any) => {
      const quota = await getProviderQuota(req.params.name);
      if (!quota) {
        return reply.code(404).send({ error: "Provider quota not found" });
      }

      return quota;
    }
  );

  // Providers: CRUD operations
  app.get("/api/providers", async () => {
    const currentConfig = (await readConfigFile()) as ConfigWithProviders;
    return currentConfig.Providers || [];
  });

  app.post("/api/providers", async (req: any, reply: any) => {
    if (!isProviderRecord(req.body)) {
      return reply.code(400).send({ error: "Invalid provider payload" });
    }

    const currentConfig = (await readConfigFile()) as ConfigWithProviders;
    const providers = Array.isArray(currentConfig.Providers) ? currentConfig.Providers : [];

    if (providers.some((provider) => provider.name === req.body.name)) {
      return reply.code(409).send({ error: "Provider name already exists" });
    }

    await backupConfigFile();
    currentConfig.Providers = [...providers, req.body];
    await writeConfigFile(currentConfig);

    return { ok: true, index: currentConfig.Providers.length - 1 };
  });

  app.put(
    "/api/providers/:index",
    async (req: any, reply: any) => {
      if (!isProviderRecord(req.body)) {
        return reply.code(400).send({ error: "Invalid provider payload" });
      }

      const currentConfig = (await readConfigFile()) as ConfigWithProviders;
      const providers = Array.isArray(currentConfig.Providers) ? currentConfig.Providers : [];
      const providerIndex = parseProviderIndex(req.params.index);

      if (providerIndex === null || providerIndex >= providers.length) {
        return reply.code(404).send({ error: "Provider not found" });
      }

      const duplicateNameExists = providers.some(
        (provider, index) => provider.name === req.body.name && index !== providerIndex
      );

      if (duplicateNameExists) {
        return reply.code(409).send({ error: "Provider name already exists" });
      }

      await backupConfigFile();
      providers[providerIndex] = req.body;
      currentConfig.Providers = providers;
      await writeConfigFile(currentConfig);

      return { ok: true };
    }
  );

  app.delete(
    "/api/providers/:index",
    async (req: any, reply: any) => {
      const currentConfig = (await readConfigFile()) as ConfigWithProviders;
      const providers = Array.isArray(currentConfig.Providers) ? currentConfig.Providers : [];
      const providerIndex = parseProviderIndex(req.params.index);

      if (providerIndex === null || providerIndex >= providers.length) {
        return reply.code(404).send({ error: "Provider not found" });
      }

      await backupConfigFile();
      providers.splice(providerIndex, 1);
      currentConfig.Providers = providers;
      await writeConfigFile(currentConfig);

      return { ok: true };
    }
  );

  app.post(
    "/api/providers/:index/test",
    async (req: any, reply: any) => {
      const currentConfig = (await readConfigFile()) as ConfigWithProviders;
      const providers = Array.isArray(currentConfig.Providers) ? currentConfig.Providers : [];
      const providerIndex = parseProviderIndex(req.params.index);

      if (providerIndex === null || providerIndex >= providers.length) {
        return reply.code(404).send({ error: "Provider not found" });
      }

      const provider = providers[providerIndex];
      if (!provider.models[0]) {
        return reply.code(400).send({ error: "Provider has no models configured" });
      }

      const startedAt = Date.now();
      const { body, headers } = buildProviderTestRequest(provider);

      try {
        const response = await fetch(provider.api_base_url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5000),
        });

        const latencyMs = Date.now() - startedAt;

        if (!response.ok) {
          const errorText = await response.text();
          return {
            ok: false,
            status: response.status,
            error: errorText || response.statusText,
            latencyMs,
          };
        }

        return {
          ok: true,
          status: response.status,
          latencyMs,
        };
      } catch (error: unknown) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown provider test error",
          latencyMs: Date.now() - startedAt,
        };
      }
    }
  );

  // Add endpoint to save config.json with access control
  app.post("/api/config", async (req: any, reply: any) => {
    const newConfig = req.body;

    // Backup existing config file if it exists
    const backupPath = await backupConfigFile();
    if (backupPath) {
      console.log(`Backed up existing configuration file to ${backupPath}`);
    }

    await writeConfigFile(newConfig);
    return { success: true, message: "Config saved successfully" };
  });

  // Register static file serving with caching
  app.register(fastifyStatic, {
    root: join(__dirname, "..", "dist"),
    prefix: "/ui/",
    maxAge: "1h",
  });

  // Redirect /ui to /ui/ for proper static file serving
  app.get("/ui", async (_: any, reply: any) => {
    return reply.redirect("/ui/");
  });

  // SPA fallback: unknown /ui/* paths (React Router routes) serve index.html
  app.setNotFoundHandler(async (req: any, reply: any) => {
    if (req.url.startsWith("/ui/")) {
      const indexPath = join(__dirname, "..", "dist", "index.html");
      const html = readFileSync(indexPath, "utf8");
      return reply.type("text/html").send(html);
    }
    return reply.status(404).send({
      message: `Route ${req.method}:${req.url} not found`,
      error: "Not Found",
      statusCode: 404,
    });
  });

  // Get log file list endpoint
  app.get("/api/logs/files", async (req: any, reply: any) => {
    try {
      const logDir = join(homedir(), ".claude-code-router", "logs");
      const logFiles: Array<{ name: string; path: string; size: number; lastModified: string }> = [];

      if (existsSync(logDir)) {
        const files = readdirSync(logDir);

        for (const file of files) {
          if (file.endsWith('.log')) {
            const filePath = join(logDir, file);
            const stats = statSync(filePath);

            logFiles.push({
              name: file,
              path: filePath,
              size: stats.size,
              lastModified: stats.mtime.toISOString()
            });
          }
        }

        // Sort by modification time in descending order
        logFiles.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
      }

      return logFiles;
    } catch (error) {
      console.error("Failed to get log files:", error);
      reply.status(500).send({ error: "Failed to get log files" });
    }
  });

  // Get log content endpoint
  app.get("/api/logs", async (req: any, reply: any) => {
    try {
      const filePath = (req.query as any).file as string;
      let logFilePath: string;

      if (filePath) {
        // If file path is specified, use the specified path
        logFilePath = filePath;
      } else {
        // If file path is not specified, use default log file path
        logFilePath = join(homedir(), ".claude-code-router", "logs", "app.log");
      }

      if (!existsSync(logFilePath)) {
        return [];
      }

      const logContent = readFileSync(logFilePath, 'utf8');
      const logLines = logContent.split('\n').filter(line => line.trim())

      return logLines;
    } catch (error) {
      console.error("Failed to get logs:", error);
      reply.status(500).send({ error: "Failed to get logs" });
    }
  });

  // Clear log content endpoint
  app.delete("/api/logs", async (req: any, reply: any) => {
    try {
      const filePath = (req.query as any).file as string;
      let logFilePath: string;

      if (filePath) {
        // If file path is specified, use the specified path
        logFilePath = filePath;
      } else {
        // If file path is not specified, use default log file path
        logFilePath = join(homedir(), ".claude-code-router", "logs", "app.log");
      }

      if (existsSync(logFilePath)) {
        writeFileSync(logFilePath, '', 'utf8');
      }

      return { success: true, message: "Logs cleared successfully" };
    } catch (error) {
      console.error("Failed to clear logs:", error);
      reply.status(500).send({ error: "Failed to clear logs" });
    }
  });

  // Get presets list
  app.get("/api/presets", async (req: any, reply: any) => {
    try {
      const presetsDir = join(HOME_DIR, "presets");

      if (!existsSync(presetsDir)) {
        return { presets: [] };
      }

      const entries = readdirSync(presetsDir, { withFileTypes: true });
      const presetDirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);

      const presets: Array<PresetMetadata & { installed: boolean; id: string }> = [];

      for (const dirName of presetDirs) {
        const presetDir = join(presetsDir, dirName);
        try {
          const manifestPath = join(presetDir, "manifest.json");
          const content = readFileSync(manifestPath, 'utf-8');
          const manifest = JSON.parse(content);

          // Extract metadata fields
          const { Providers, Router, PORT, HOST, API_TIMEOUT_MS, PROXY_URL, LOG, LOG_LEVEL, StatusLine, NON_INTERACTIVE_MODE, ...metadata } = manifest;

          presets.push({
            id: dirName,  // Use directory name as unique identifier
            name: metadata.name || dirName,
            version: metadata.version || '1.0.0',
            description: metadata.description,
            author: metadata.author,
            homepage: metadata.homepage,
            repository: metadata.repository,
            license: metadata.license,
            keywords: metadata.keywords,
            ccrVersion: metadata.ccrVersion,
            source: metadata.source,
            sourceType: metadata.sourceType,
            checksum: metadata.checksum,
            installed: true,
          });
        } catch (error) {
          console.error(`Failed to read preset ${dirName}:`, error);
        }
      }

      return { presets };
    } catch (error) {
      console.error("Failed to get presets:", error);
      reply.status(500).send({ error: "Failed to get presets" });
    }
  });

  // Get preset details
  app.get("/api/presets/:name", async (req: any, reply: any) => {
    try {
      const { name } = req.params;
      const presetDir = getPresetDir(name);

      if (!existsSync(presetDir)) {
        reply.status(404).send({ error: "Preset not found" });
        return;
      }

      const manifest = await readManifestFromDir(presetDir);
      const presetFile = manifestToPresetFile(manifest);

      // Return preset info, config uses the applied userValues configuration
      return {
        ...presetFile,
        config: loadConfigFromManifest(manifest, presetDir),
        userValues: manifest.userValues || {},
      };
    } catch (error: any) {
      console.error("Failed to get preset:", error);
      reply.status(500).send({ error: error.message || "Failed to get preset" });
    }
  });

  // Apply preset (configure sensitive information)
  app.post("/api/presets/:name/apply", async (req: any, reply: any) => {
    try {
      const { name } = req.params;
      const { secrets } = req.body;

      const presetDir = getPresetDir(name);

      if (!existsSync(presetDir)) {
        reply.status(404).send({ error: "Preset not found" });
        return;
      }

      // Read existing manifest
      const manifest = await readManifestFromDir(presetDir);

      // Save user input to userValues (keep original config unchanged)
      const updatedManifest: ManifestFile = { ...manifest };

      // Save or update userValues
      if (secrets && Object.keys(secrets).length > 0) {
        updatedManifest.userValues = {
          ...updatedManifest.userValues,
          ...secrets,
        };
      }

      // Save updated manifest
      await saveManifest(name, updatedManifest);

      return { success: true, message: "Preset applied successfully" };
    } catch (error: any) {
      console.error("Failed to apply preset:", error);
      reply.status(500).send({ error: error.message || "Failed to apply preset" });
    }
  });

  // Delete preset
  app.delete("/api/presets/:name", async (req: any, reply: any) => {
    try {
      const { name } = req.params;
      const presetDir = getPresetDir(name);

      if (!existsSync(presetDir)) {
        reply.status(404).send({ error: "Preset not found" });
        return;
      }

      // Recursively delete entire directory
      rmSync(presetDir, { recursive: true, force: true });

      return { success: true, message: "Preset deleted successfully" };
    } catch (error: any) {
      console.error("Failed to delete preset:", error);
      reply.status(500).send({ error: error.message || "Failed to delete preset" });
    }
  });

  // Get preset market list
  app.get("/api/presets/market", async (req: any, reply: any) => {
    try {
      // Use market presets function
      const marketPresets = await getMarketPresets();
      return { presets: marketPresets };
    } catch (error: any) {
      console.error("Failed to get market presets:", error);
      reply.status(500).send({ error: error.message || "Failed to get market presets" });
    }
  });

  // Install preset from GitHub repository by preset name
  app.post("/api/presets/install/github", async (req: any, reply: any) => {
    try {
      const { presetName } = req.body;

      if (!presetName) {
        reply.status(400).send({ error: "Preset name is required" });
        return;
      }

      // Check if preset is in the marketplace
      const marketPreset = await findMarketPresetByName(presetName);
      if (!marketPreset) {
        reply.status(400).send({
          error: "Preset not found in marketplace",
          message: `Preset '${presetName}' is not available in the official marketplace. Please check the available presets.`
        });
        return;
      }

      // Get repository from market preset
      if (!marketPreset.repo) {
        reply.status(400).send({
          error: "Invalid preset data",
          message: `Preset '${presetName}' does not have repository information`
        });
        return;
      }

      // Parse GitHub repository URL
      const githubRepoMatch = marketPreset.repo.match(/(?:github\.com[:/]|^)([^/]+)\/([^/\s#]+?)(?:\.git)?$/);
      if (!githubRepoMatch) {
        reply.status(400).send({ error: "Invalid GitHub repository URL" });
        return;
      }

      const [, owner, repoName] = githubRepoMatch;

      // Use preset name from market
      const installedPresetName = marketPreset.name || presetName;

      // Check if already installed BEFORE downloading
      if (await isPresetInstalled(installedPresetName)) {
        reply.status(409).send({
          error: "Preset already installed",
          message: `Preset '${installedPresetName}' is already installed. To update or reconfigure, please delete it first using the delete button.`,
          presetName: installedPresetName
        });
        return;
      }

      // Download GitHub repository ZIP file
      const downloadUrl = `https://github.com/${owner}/${repoName}/archive/refs/heads/main.zip`;
      const tempFile = await downloadPresetToTemp(downloadUrl);

      // Load preset to validate structure
      const preset = await loadPresetFromZip(tempFile);

      // Double-check if already installed (in case of race condition)
      if (await isPresetInstalled(installedPresetName)) {
        unlinkSync(tempFile);
        reply.status(409).send({
          error: "Preset already installed",
          message: `Preset '${installedPresetName}' was installed while downloading. Please try again.`,
          presetName: installedPresetName
        });
        return;
      }

      // Extract to target directory
      const targetDir = getPresetDir(installedPresetName);
      await extractPreset(tempFile, targetDir);

      // Read manifest and add repo information
      const manifest = await readManifestFromDir(targetDir);

      // Add repo information to manifest from market data
      manifest.repository = marketPreset.repo;
      if (marketPreset.url) {
        manifest.source = marketPreset.url;
      }

      // Save updated manifest
      await saveManifest(installedPresetName, manifest);

      // Clean up temp file
      unlinkSync(tempFile);

      return {
        success: true,
        presetName: installedPresetName,
        preset: {
          ...preset.metadata,
          installed: true,
        }
      };
    } catch (error: any) {
      console.error("Failed to install preset from GitHub:", error);
      reply.status(500).send({ error: error.message || "Failed to install preset from GitHub" });
    }
  });

  // Helper function: Load preset from ZIP
  async function loadPresetFromZip(zipFile: string): Promise<PresetFile> {
    const zip = new AdmZip(zipFile);

    // First try to find manifest.json in root directory
    let entry = zip.getEntry('manifest.json');

    // If not in root, try to find in subdirectories (handle GitHub repo archive structure)
    if (!entry) {
      const entries = zip.getEntries();
      // Find any manifest.json file
      entry = entries.find(e => e.entryName.includes('manifest.json')) || null;
    }

    if (!entry) {
      throw new Error('Invalid preset file: manifest.json not found');
    }

    const manifest = JSON.parse(entry.getData().toString('utf-8')) as ManifestFile;
    return manifestToPresetFile(manifest);
  }

  return server;
};
