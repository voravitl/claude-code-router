import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { HOME_DIR } from "@CCR/shared";

export interface RoutingEvent {
  sessionId: string;
  timestamp: string;
  provider: string;
  model: string;
  scenarioType: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: "success" | "error";
  errorMessage?: string;
}

export interface RoutingStats {
  totalRequests: number;
  totalErrors: number;
  errorRate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgLatencyMs: number;
  byModel: Record<string, { requests: number; inputTokens: number; outputTokens: number; avgLatencyMs: number; errors: number }>;
  byProvider: Record<string, { requests: number; inputTokens: number; outputTokens: number; avgLatencyMs: number; errors: number }>;
  byScenario: Record<string, { requests: number; inputTokens: number; outputTokens: number; avgLatencyMs: number; errors: number }>;
}

const HISTORY_DIR = path.join(HOME_DIR, "history");
const HISTORY_FILE = path.join(HISTORY_DIR, "routing.jsonl");

export async function recordRoutingEvent(event: RoutingEvent): Promise<void> {
  try {
    const line = JSON.stringify(event) + "\n";
    await fs.appendFile(HISTORY_FILE, line, "utf-8");
  } catch (error) {
    console.error("Failed to record routing event:", error);
  }
}

export async function getRoutingHistory(
  limit: number = 50,
  offset: number = 0
): Promise<RoutingEvent[]> {
  const events: RoutingEvent[] = [];

  try {
    await fs.access(HISTORY_FILE);
  } catch {
    return events;
  }

  return new Promise((resolve, reject) => {
    const stream = createReadStream(HISTORY_FILE, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: stream });
    const lines: string[] = [];

    rl.on("line", (line) => {
      if (line.trim()) lines.push(line);
    });

    rl.on("close", () => {
      const reversed = lines.reverse();
      const paginated = reversed.slice(offset, offset + limit);
      const parsed = paginated
        .map((line) => {
          try {
            return JSON.parse(line) as RoutingEvent;
          } catch {
            return null;
          }
        })
        .filter(Boolean) as RoutingEvent[];
      resolve(parsed);
    });

    rl.on("error", reject);
  });
}

export async function getRoutingStats(): Promise<RoutingStats> {
  const stats: RoutingStats = {
    totalRequests: 0,
    totalErrors: 0,
    errorRate: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    avgLatencyMs: 0,
    byModel: {},
    byProvider: {},
    byScenario: {},
  };

  try {
    await fs.access(HISTORY_FILE);
  } catch {
    return stats;
  }

  return new Promise((resolve, reject) => {
    const stream = createReadStream(HISTORY_FILE, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: stream });

    let totalLatency = 0;

    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line) as RoutingEvent;
        stats.totalRequests++;
        stats.totalInputTokens += event.inputTokens || 0;
        stats.totalOutputTokens += event.outputTokens || 0;
        totalLatency += event.latencyMs || 0;

        if (event.status === "error") {
          stats.totalErrors++;
        }

        // By model
        if (!stats.byModel[event.model]) {
          stats.byModel[event.model] = { requests: 0, inputTokens: 0, outputTokens: 0, avgLatencyMs: 0, errors: 0 };
        }
        const modelStats = stats.byModel[event.model];
        modelStats.requests++;
        modelStats.inputTokens += event.inputTokens || 0;
        modelStats.outputTokens += event.outputTokens || 0;
        modelStats.avgLatencyMs += event.latencyMs || 0;
        if (event.status === "error") modelStats.errors++;

        // By provider
        if (!stats.byProvider[event.provider]) {
          stats.byProvider[event.provider] = { requests: 0, inputTokens: 0, outputTokens: 0, avgLatencyMs: 0, errors: 0 };
        }
        const providerStats = stats.byProvider[event.provider];
        providerStats.requests++;
        providerStats.inputTokens += event.inputTokens || 0;
        providerStats.outputTokens += event.outputTokens || 0;
        providerStats.avgLatencyMs += event.latencyMs || 0;
        if (event.status === "error") providerStats.errors++;

        // By scenario
        if (!stats.byScenario[event.scenarioType]) {
          stats.byScenario[event.scenarioType] = { requests: 0, inputTokens: 0, outputTokens: 0, avgLatencyMs: 0, errors: 0 };
        }
        const scenarioStats = stats.byScenario[event.scenarioType];
        scenarioStats.requests++;
        scenarioStats.inputTokens += event.inputTokens || 0;
        scenarioStats.outputTokens += event.outputTokens || 0;
        scenarioStats.avgLatencyMs += event.latencyMs || 0;
        if (event.status === "error") scenarioStats.errors++;
      } catch {
        // Skip malformed lines
      }
    });

    rl.on("close", () => {
      if (stats.totalRequests > 0) {
        stats.avgLatencyMs = Math.round(totalLatency / stats.totalRequests);
        stats.errorRate = Math.round((stats.totalErrors / stats.totalRequests) * 1000) / 10;
      }

      // Normalize avg latency for sub-groupings
      for (const key of Object.keys(stats.byModel)) {
        const s = stats.byModel[key];
        s.avgLatencyMs = s.requests > 0 ? Math.round(s.avgLatencyMs / s.requests) : 0;
      }
      for (const key of Object.keys(stats.byProvider)) {
        const s = stats.byProvider[key];
        s.avgLatencyMs = s.requests > 0 ? Math.round(s.avgLatencyMs / s.requests) : 0;
      }
      for (const key of Object.keys(stats.byScenario)) {
        const s = stats.byScenario[key];
        s.avgLatencyMs = s.requests > 0 ? Math.round(s.avgLatencyMs / s.requests) : 0;
      }

      resolve(stats);
    });

    rl.on("error", reject);
  });
}

export async function clearRoutingHistory(): Promise<void> {
  try {
    await fs.writeFile(HISTORY_FILE, "", "utf-8");
  } catch (error) {
    console.error("Failed to clear routing history:", error);
    throw error;
  }
}
