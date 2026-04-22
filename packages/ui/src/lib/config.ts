import type { Config, FallbackConfig, Provider, RouterConfig, RouteSlot, Transformer } from "@/types";

export interface RoutingTierDescriptor {
  key: RouteSlot;
  label: string;
  description: string;
  badge: string;
}

export const ROUTING_TIER_GROUPS: Array<{
  title: string;
  description: string;
  tiers: RoutingTierDescriptor[];
}> = [
  {
    title: "Generalist tiers",
    description: "Primary lanes for day-to-day chat, coding, and review work.",
    tiers: [
      {
        key: "default",
        label: "Default",
        description: "Main route for normal requests and general conversation.",
        badge: "core",
      },
      {
        key: "think",
        label: "Think",
        description: "Use a stronger reasoning model when the task needs deeper analysis.",
        badge: "reasoning",
      },
      {
        key: "code",
        label: "Code",
        description: "Bias toward coding-focused models for implementation and debugging.",
        badge: "coding",
      },
      {
        key: "codeReview",
        label: "Code Review",
        description: "Separate review traffic so critique can use a different model profile.",
        badge: "review",
      },
    ],
  },
  {
    title: "Specialized tiers",
    description: "Context and modality-specific routes that work like explicit guardrails.",
    tiers: [
      {
        key: "background",
        label: "Background",
        description: "Cheap, fast route for non-critical or asynchronous work.",
        badge: "fast lane",
      },
      {
        key: "longContext",
        label: "Long Context",
        description: "Used once prompts cross the long-context threshold.",
        badge: "context",
      },
      {
        key: "image",
        label: "Image",
        description: "Dedicated route for image-capable or multimodal models.",
        badge: "vision",
      },
      {
        key: "webSearch",
        label: "Web Search",
        description: "Optional route for browsing or external retrieval workflows.",
        badge: "search",
      },
    ],
  },
];

const DEFAULT_ROUTER: RouterConfig = {
  default: "",
  background: "",
  think: "",
  code: "",
  codeReview: "",
  longContext: "",
  longContextThreshold: 60000,
  webSearch: "",
  image: "",
  haikuModels: [],
  opusKeyword: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneRecord<T extends Record<string, unknown>>(value: T): T {
  return { ...value };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function normalizeProvider(provider: unknown): Provider {
  const base = isRecord(provider) ? cloneRecord(provider) : {};

  return {
    ...base,
    name: typeof base.name === "string" ? base.name : "",
    api_base_url: typeof base.api_base_url === "string" ? base.api_base_url : "",
    api_key: typeof base.api_key === "string" ? base.api_key : "",
    models: toStringArray(base.models),
    transformer: isRecord(base.transformer)
      ? (cloneRecord(base.transformer) as Provider["transformer"])
      : undefined,
  };
}

function normalizeTransformer(transformer: unknown): Transformer {
  const base = isRecord(transformer) ? cloneRecord(transformer) : {};

  return {
    ...base,
    name: typeof base.name === "string" ? base.name : undefined,
    path: typeof base.path === "string" ? base.path : "",
    options: isRecord(base.options) ? cloneRecord(base.options) : undefined,
  };
}

function normalizeStatusLine(value: unknown): Config["StatusLine"] {
  if (!isRecord(value)) {
    return {
      enabled: false,
      currentStyle: "default",
      default: { modules: [] },
      powerline: { modules: [] },
    };
  }

  return {
    ...value,
    enabled: typeof value.enabled === "boolean" ? value.enabled : false,
    currentStyle: typeof value.currentStyle === "string" ? value.currentStyle : "default",
    default:
      isRecord(value.default) && Array.isArray(value.default.modules)
        ? {
            ...value.default,
            modules: value.default.modules,
          }
        : { modules: [] },
    powerline:
      isRecord(value.powerline) && Array.isArray(value.powerline.modules)
        ? {
            ...value.powerline,
            modules: value.powerline.modules,
          }
        : { modules: [] },
    fontFamily: typeof value.fontFamily === "string" ? value.fontFamily : undefined,
  };
}

function normalizeRouter(value: unknown): RouterConfig {
  const base = isRecord(value) ? cloneRecord(value) : {};

  return {
    ...DEFAULT_ROUTER,
    ...base,
    default: typeof base.default === "string" ? base.default : "",
    background: typeof base.background === "string" ? base.background : "",
    think: typeof base.think === "string" ? base.think : "",
    code: typeof base.code === "string" ? base.code : "",
    codeReview: typeof base.codeReview === "string" ? base.codeReview : "",
    longContext: typeof base.longContext === "string" ? base.longContext : "",
    longContextThreshold: toNumber(base.longContextThreshold, DEFAULT_ROUTER.longContextThreshold),
    webSearch: typeof base.webSearch === "string" ? base.webSearch : "",
    image: typeof base.image === "string" ? base.image : "",
    haikuModels: toStringArray(base.haikuModels),
    opusKeyword: typeof base.opusKeyword === "string" ? base.opusKeyword : "",
    priorityOrder: toStringArray(base.priorityOrder),
  };
}

function normalizeFallback(value: unknown): FallbackConfig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const normalized: FallbackConfig = {};

  Object.entries(value).forEach(([key, items]) => {
    normalized[key] = toStringArray(items);
  });

  return normalized;
}

export function normalizeConfig(value: unknown): Config {
  const base = isRecord(value) ? cloneRecord(value) : {};

  return {
    ...base,
    LOG: typeof base.LOG === "boolean" ? base.LOG : false,
    LOG_LEVEL: typeof base.LOG_LEVEL === "string" ? base.LOG_LEVEL : "info",
    CLAUDE_PATH: typeof base.CLAUDE_PATH === "string" ? base.CLAUDE_PATH : "",
    HOST: typeof base.HOST === "string" ? base.HOST : "127.0.0.1",
    PORT: toNumber(base.PORT, 3456),
    APIKEY: typeof base.APIKEY === "string" ? base.APIKEY : "",
    API_TIMEOUT_MS: toNumber(base.API_TIMEOUT_MS, 600000),
    PROXY_URL: typeof base.PROXY_URL === "string" ? base.PROXY_URL : "",
    CUSTOM_ROUTER_PATH: typeof base.CUSTOM_ROUTER_PATH === "string" ? base.CUSTOM_ROUTER_PATH : "",
    forceUseImageAgent: typeof base.forceUseImageAgent === "boolean" ? base.forceUseImageAgent : false,
    transformers: Array.isArray(base.transformers)
      ? base.transformers.map((item) => normalizeTransformer(item))
      : [],
    Providers: Array.isArray(base.Providers) ? base.Providers.map((item) => normalizeProvider(item)) : [],
    StatusLine: normalizeStatusLine(base.StatusLine),
    Router: normalizeRouter(base.Router),
    fallback: normalizeFallback(base.fallback),
  };
}

export function buildModelOptions(config: Config) {
  return config.Providers.flatMap((provider) =>
    provider.models.map((model) => ({
      value: `${provider.name},${model}`,
      label: `${provider.name}, ${model}`,
    })),
  );
}

export function getFallbacks(config: Config, slot: RouteSlot): string[] {
  return config.fallback?.[slot] ?? [];
}

export function setFallbacks(config: Config, slot: RouteSlot, values: string[]): Config {
  const nextFallback = {
    ...(config.fallback ?? {}),
    [slot]: values,
  };

  return {
    ...config,
    fallback: nextFallback,
  };
}

export function countAssignedRoutes(config: Config): number {
  return ROUTING_TIER_GROUPS.flatMap((group) => group.tiers).filter(
    (tier) => Boolean(config.Router[tier.key]),
  ).length;
}

export function countFallbackCoverage(config: Config): number {
  return ROUTING_TIER_GROUPS.flatMap((group) => group.tiers).filter(
    (tier) => getFallbacks(config, tier.key).length > 0,
  ).length;
}

export function countModels(config: Config): number {
  return config.Providers.reduce((total, provider) => total + provider.models.length, 0);
}
