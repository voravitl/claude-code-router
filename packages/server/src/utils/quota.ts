import fs from "node:fs/promises";
import path from "node:path";
import { HOME_DIR } from "@CCR/shared";
import { readConfigFile } from "./index";

export interface ProviderQuota {
  name: string;
  requestsLimit: number | null;
  requestsRemaining: number | null;
  requestsReset: string | null;
  tokensLimit: number | null;
  tokensRemaining: number | null;
  tokensReset: string | null;
  todayRequests: number;
  todayInputTokens: number;
  todayOutputTokens: number;
  todayCostUsd: number;
  requestsUsedPct: number | null;
  tokensUsedPct: number | null;
  updatedAt: string;
}

export type ProviderQuotaAlertLevel = "ok" | "warning" | "critical";

type HeaderParser = {
  requestsLimit: string;
  requestsRemaining: string;
  requestsReset: string;
  tokensLimit: string;
  tokensRemaining: string;
  tokensReset: string;
};

type Pricing = {
  inputPer1MTokens: number;
  outputPer1MTokens: number;
};

type ProviderConfig = {
  name: string;
  api_base_url?: string;
  _template?: string;
  transformer?: {
    use?: unknown[];
  };
};

type RoutingEvent = {
  timestamp: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

type UsageTotals = {
  todayRequests: number;
  todayInputTokens: number;
  todayOutputTokens: number;
  todayCostUsd: number;
  updatedAt: string | null;
};

const HISTORY_FILE = path.join(HOME_DIR, "history", "routing.jsonl");

const quotaStore = new Map<string, ProviderQuota>();

const ZERO_USAGE: UsageTotals = {
  todayRequests: 0,
  todayInputTokens: 0,
  todayOutputTokens: 0,
  todayCostUsd: 0,
  updatedAt: null,
};

const TEMPLATE_PRICING: Record<string, Pricing> = {
  "anthropic-pro": { inputPer1MTokens: 3, outputPer1MTokens: 15 },
  "codex-pro": { inputPer1MTokens: 1.1, outputPer1MTokens: 4.4 },
  "gemini-pro": { inputPer1MTokens: 1.25, outputPer1MTokens: 10 },
  "zai-coding": { inputPer1MTokens: 0, outputPer1MTokens: 0 },
  "opencode-go": { inputPer1MTokens: 0, outputPer1MTokens: 0 },
  "opencode-zen": { inputPer1MTokens: 0, outputPer1MTokens: 0 },
  "ollama-local": { inputPer1MTokens: 0, outputPer1MTokens: 0 },
  openrouter: { inputPer1MTokens: 1.1, outputPer1MTokens: 4.4 },
  deepseek: { inputPer1MTokens: 0.14, outputPer1MTokens: 0.28 },
  groq: { inputPer1MTokens: 0.59, outputPer1MTokens: 0.79 },
};

const MODEL_PRICING_RULES: Array<{ pattern: RegExp; pricing: Pricing }> = [
  { pattern: /^claude-opus-4-7$/i, pricing: { inputPer1MTokens: 15, outputPer1MTokens: 75 } },
  {
    pattern: /^(claude-sonnet-4-6|claude-3-7-sonnet|claude-3-5-sonnet)/i,
    pricing: { inputPer1MTokens: 3, outputPer1MTokens: 15 },
  },
  { pattern: /^o4-mini$/i, pricing: { inputPer1MTokens: 1.1, outputPer1MTokens: 4.4 } },
  { pattern: /^gemini-2\.5-pro$/i, pricing: { inputPer1MTokens: 1.25, outputPer1MTokens: 10 } },
  {
    pattern: /^(deepseek-r2|deepseek-reasoner|deepseek\/deepseek-r2)$/i,
    pricing: { inputPer1MTokens: 0.14, outputPer1MTokens: 0.28 },
  },
  {
    pattern: /^llama-3\.3-70b-versatile$/i,
    pricing: { inputPer1MTokens: 0.59, outputPer1MTokens: 0.79 },
  },
  {
    pattern: /^(llama3\.3|qwen3|devstral|glm-5\.1|devstral-2|minimax-m2\.7|kimi-k2\.6)$/i,
    pricing: { inputPer1MTokens: 0, outputPer1MTokens: 0 },
  },
];

export const HEADER_PARSERS = {
  openai: {
    requestsLimit: "x-ratelimit-limit-requests",
    requestsRemaining: "x-ratelimit-remaining-requests",
    requestsReset: "x-ratelimit-reset-requests",
    tokensLimit: "x-ratelimit-limit-tokens",
    tokensRemaining: "x-ratelimit-remaining-tokens",
    tokensReset: "x-ratelimit-reset-tokens",
  },
  anthropic: {
    requestsLimit: "anthropic-ratelimit-requests-limit",
    requestsRemaining: "anthropic-ratelimit-requests-remaining",
    requestsReset: "anthropic-ratelimit-requests-reset",
    tokensLimit: "anthropic-ratelimit-tokens-limit",
    tokensRemaining: "anthropic-ratelimit-tokens-remaining",
    tokensReset: "anthropic-ratelimit-tokens-reset",
  },
} as const satisfies Record<string, HeaderParser>;

function createEmptyQuota(name: string): ProviderQuota {
  return {
    name,
    requestsLimit: null,
    requestsRemaining: null,
    requestsReset: null,
    tokensLimit: null,
    tokensRemaining: null,
    tokensReset: null,
    todayRequests: 0,
    todayInputTokens: 0,
    todayOutputTokens: 0,
    todayCostUsd: 0,
    requestsUsedPct: null,
    tokensUsedPct: null,
    updatedAt: new Date().toISOString(),
  };
}

function isAnthropicProvider(provider?: ProviderConfig): boolean {
  if (!provider) {
    return false;
  }

  if (provider.api_base_url?.includes("anthropic.com/v1/messages")) {
    return true;
  }

  return provider.transformer?.use?.some(
    (entry) => typeof entry === "string" && entry === "anthropic"
  ) ?? false;
}

function isLocalProvider(provider?: ProviderConfig): boolean {
  if (!provider?.api_base_url) {
    return false;
  }

  return provider.api_base_url.includes("localhost") || provider.api_base_url.includes("127.0.0.1");
}

function roundTo(value: number, precision: number): number {
  return Number(value.toFixed(precision));
}

function parseNullableNumber(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDurationToMs(value: string): number | null {
  const matches = Array.from(value.matchAll(/(\d+)(ms|s|m|h|d)/g));

  if (matches.length === 0) {
    return null;
  }

  let totalMs = 0;

  for (const [, amountText, unit] of matches) {
    const amount = Number(amountText);

    switch (unit) {
      case "ms":
        totalMs += amount;
        break;
      case "s":
        totalMs += amount * 1000;
        break;
      case "m":
        totalMs += amount * 60 * 1000;
        break;
      case "h":
        totalMs += amount * 60 * 60 * 1000;
        break;
      case "d":
        totalMs += amount * 24 * 60 * 60 * 1000;
        break;
      default:
        break;
    }
  }

  return totalMs;
}

function parseResetValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmedValue = value.trim();
  const parsedDate = Date.parse(trimmedValue);

  if (!Number.isNaN(parsedDate)) {
    return new Date(parsedDate).toISOString();
  }

  if (/^\d+$/.test(trimmedValue)) {
    const numericValue = Number(trimmedValue);

    if (numericValue > 1_000_000_000_000) {
      return new Date(numericValue).toISOString();
    }

    if (numericValue > 1_000_000_000) {
      return new Date(numericValue * 1000).toISOString();
    }

    return new Date(Date.now() + numericValue * 1000).toISOString();
  }

  const durationMs = parseDurationToMs(trimmedValue);
  if (durationMs !== null) {
    return new Date(Date.now() + durationMs).toISOString();
  }

  return null;
}

function calculateUsedPct(limit: number | null, remaining: number | null): number | null {
  if (limit === null || remaining === null || limit <= 0) {
    return null;
  }

  return roundTo(((limit - remaining) / limit) * 100, 1);
}

function getParserForHeaders(provider: ProviderConfig | undefined, headers: Headers): HeaderParser | null {
  const anthropicHeaderPresent = Object.values(HEADER_PARSERS.anthropic).some((headerName) =>
    headers.has(headerName)
  );
  if (anthropicHeaderPresent || isAnthropicProvider(provider)) {
    return HEADER_PARSERS.anthropic;
  }

  const openAiHeaderPresent = Object.values(HEADER_PARSERS.openai).some((headerName) =>
    headers.has(headerName)
  );
  if (openAiHeaderPresent || provider) {
    return HEADER_PARSERS.openai;
  }

  return null;
}

function hasQuotaValues(quota: Pick<
  ProviderQuota,
  | "requestsLimit"
  | "requestsRemaining"
  | "requestsReset"
  | "tokensLimit"
  | "tokensRemaining"
  | "tokensReset"
>): boolean {
  return Object.values(quota).some((value) => value !== null);
}

function resolvePricing(provider: ProviderConfig | undefined, providerName: string, model: string): Pricing | null {
  for (const rule of MODEL_PRICING_RULES) {
    if (rule.pattern.test(model)) {
      return rule.pricing;
    }
  }

  if (provider?._template && TEMPLATE_PRICING[provider._template]) {
    return TEMPLATE_PRICING[provider._template];
  }

  if (TEMPLATE_PRICING[providerName]) {
    return TEMPLATE_PRICING[providerName];
  }

  if (isLocalProvider(provider)) {
    return { inputPer1MTokens: 0, outputPer1MTokens: 0 };
  }

  return null;
}

function getCostUsd(pricing: Pricing | null, inputTokens: number, outputTokens: number): number {
  if (!pricing) {
    return 0;
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1MTokens;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1MTokens;

  return inputCost + outputCost;
}

function isRoutingEvent(value: unknown): value is RoutingEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RoutingEvent>;
  return (
    typeof candidate.timestamp === "string" &&
    typeof candidate.provider === "string" &&
    typeof candidate.model === "string"
  );
}

async function getTodayUsageByProvider(providers: ProviderConfig[]): Promise<Map<string, UsageTotals>> {
  const usageByProvider = new Map<string, UsageTotals>();

  let historyContent = "";
  try {
    historyContent = await fs.readFile(HISTORY_FILE, "utf-8");
  } catch {
    return usageByProvider;
  }

  const providerMap = new Map(providers.map((provider) => [provider.name, provider]));
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  for (const line of historyContent.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    let parsedLine: unknown;
    try {
      parsedLine = JSON.parse(line);
    } catch {
      continue;
    }

    if (!isRoutingEvent(parsedLine)) {
      continue;
    }

    const eventTimestamp = new Date(parsedLine.timestamp);
    if (Number.isNaN(eventTimestamp.getTime()) || eventTimestamp < startOfToday) {
      continue;
    }

    const provider = providerMap.get(parsedLine.provider);
    const pricing = resolvePricing(provider, parsedLine.provider, parsedLine.model);
    const currentUsage = usageByProvider.get(parsedLine.provider) ?? { ...ZERO_USAGE };

    currentUsage.todayRequests += 1;
    currentUsage.todayInputTokens += parsedLine.inputTokens || 0;
    currentUsage.todayOutputTokens += parsedLine.outputTokens || 0;
    currentUsage.todayCostUsd += getCostUsd(
      pricing,
      parsedLine.inputTokens || 0,
      parsedLine.outputTokens || 0
    );
    currentUsage.updatedAt = parsedLine.timestamp;

    usageByProvider.set(parsedLine.provider, currentUsage);
  }

  return usageByProvider;
}

function mergeQuota(name: string, storedQuota: ProviderQuota | undefined, usage: UsageTotals): ProviderQuota {
  const baseQuota = storedQuota ?? createEmptyQuota(name);

  return {
    ...baseQuota,
    todayRequests: usage.todayRequests,
    todayInputTokens: usage.todayInputTokens,
    todayOutputTokens: usage.todayOutputTokens,
    todayCostUsd: roundTo(usage.todayCostUsd, 6),
    requestsUsedPct: calculateUsedPct(baseQuota.requestsLimit, baseQuota.requestsRemaining),
    tokensUsedPct: calculateUsedPct(baseQuota.tokensLimit, baseQuota.tokensRemaining),
    updatedAt: usage.updatedAt ?? baseQuota.updatedAt,
  };
}

export async function updateQuotaFromHeaders(providerName: string, headers: Headers): Promise<void> {
  const config = await readConfigFile();
  const providers = Array.isArray(config.Providers) ? (config.Providers as ProviderConfig[]) : [];
  const provider = providers.find((entry) => entry.name === providerName);
  const parser = getParserForHeaders(provider, headers);

  if (!parser) {
    return;
  }

  const nextFields = {
    requestsLimit: parseNullableNumber(headers.get(parser.requestsLimit)),
    requestsRemaining: parseNullableNumber(headers.get(parser.requestsRemaining)),
    requestsReset: parseResetValue(headers.get(parser.requestsReset)),
    tokensLimit: parseNullableNumber(headers.get(parser.tokensLimit)),
    tokensRemaining: parseNullableNumber(headers.get(parser.tokensRemaining)),
    tokensReset: parseResetValue(headers.get(parser.tokensReset)),
  };

  if (!hasQuotaValues(nextFields)) {
    return;
  }

  const currentQuota = quotaStore.get(providerName) ?? createEmptyQuota(providerName);
  const mergedQuota: ProviderQuota = {
    ...currentQuota,
    ...Object.fromEntries(
      Object.entries(nextFields).map(([key, value]) => [
        key,
        value ?? currentQuota[key as keyof typeof nextFields],
      ])
    ),
    updatedAt: new Date().toISOString(),
  } as ProviderQuota;

  mergedQuota.requestsUsedPct = calculateUsedPct(
    mergedQuota.requestsLimit,
    mergedQuota.requestsRemaining
  );
  mergedQuota.tokensUsedPct = calculateUsedPct(
    mergedQuota.tokensLimit,
    mergedQuota.tokensRemaining
  );

  quotaStore.set(providerName, mergedQuota);
}

export async function getProviderQuotas(): Promise<ProviderQuota[]> {
  const config = await readConfigFile();
  const providers = Array.isArray(config.Providers) ? (config.Providers as ProviderConfig[]) : [];
  const usageByProvider = await getTodayUsageByProvider(providers);
  const providerNames = new Set<string>([
    ...providers.map((provider) => provider.name),
    ...quotaStore.keys(),
    ...usageByProvider.keys(),
  ]);

  return Array.from(providerNames)
    .sort((left, right) => left.localeCompare(right))
    .map((providerName) =>
      mergeQuota(providerName, quotaStore.get(providerName), usageByProvider.get(providerName) ?? ZERO_USAGE)
    );
}

export async function getProviderQuota(name: string): Promise<ProviderQuota | null> {
  const quotas = await getProviderQuotas();
  return quotas.find((quota) => quota.name === name) ?? null;
}

export function getAlertLevel(quota: ProviderQuota): ProviderQuotaAlertLevel {
  const requestsUsedPct = quota.requestsUsedPct ?? 0;
  const tokensUsedPct = quota.tokensUsedPct ?? 0;
  const highestUsage = Math.max(requestsUsedPct, tokensUsedPct);

  if (highestUsage >= 90) {
    return "critical";
  }

  if (highestUsage >= 75) {
    return "warning";
  }

  return "ok";
}
