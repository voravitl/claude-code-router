export type RouteSlot =
  | "default"
  | "background"
  | "think"
  | "code"
  | "codeReview"
  | "longContext"
  | "webSearch"
  | "image";

export type ProviderAuthMethod = 'api-key' | 'env-var' | 'none';
export type ProviderCategory = 'local' | 'cloud-subscription' | 'cloud-api';

export interface ProviderCapabilities {
  vision: boolean;
  streaming: boolean;
  functionCalling: boolean;
  thinking: boolean;
}

export interface ProviderTransformer {
  use: (string | (string | Record<string, unknown> | { max_tokens: number })[])[];
  [key: string]: any;
}

export interface Provider {
  name: string;
  api_base_url: string;
  api_key: string;
  models: string[];
  transformer?: ProviderTransformer;
  // New optional metadata fields (preserved by ConfigProvider)
  _template?: string;           // e.g. "gemini-pro"
  _capabilities?: ProviderCapabilities;
  [key: string]: any;
}

export interface RouterConfig {
  default: string;
  background: string;
  think: string;
  code: string;
  codeReview: string;
  longContext: string;
  longContextThreshold: number;
  webSearch: string;
  image: string;
  haikuModels?: string[];
  opusKeyword?: string;
  priorityOrder?: string[];
  custom?: unknown;
  [key: string]: any;
}

export interface Transformer {
  name?: string;
  path: string;
  options?: Record<string, any>;
  [key: string]: any;
}

export type FallbackConfig = Partial<Record<RouteSlot, string[]>> & {
  [key: string]: string[] | undefined;
};

export interface StatusLineModuleConfig {
  type: string;
  icon?: string;
  text: string;
  color?: string;
  background?: string;
  scriptPath?: string; // 用于script类型的模块，指定要执行的Node.js脚本文件路径
}

export interface StatusLineThemeConfig {
  modules: StatusLineModuleConfig[];
}

export interface StatusLineConfig {
  enabled: boolean;
  currentStyle: string;
  default: StatusLineThemeConfig;
  powerline: StatusLineThemeConfig;
  fontFamily?: string;
}

export interface Config {
  Providers: Provider[];
  Router: RouterConfig;
  transformers: Transformer[];
  fallback?: FallbackConfig;
  StatusLine?: StatusLineConfig;
  forceUseImageAgent?: boolean;
  // Top-level settings
  LOG: boolean;
  LOG_LEVEL: string;
  CLAUDE_PATH: string;
  HOST: string;
  PORT: number;
  APIKEY: string;
  API_TIMEOUT_MS: number;
  PROXY_URL: string;
  CUSTOM_ROUTER_PATH?: string;
  [key: string]: any;
}

export type AccessLevel = 'restricted' | 'full';

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
  tokenOptimization?: {
    originalTokens: number;
    optimizedTokens: number;
    savedTokens: number;
    wasTruncated: boolean;
    compressionRatio: string;
  };
}

export interface RoutingStats {
  totalRequests: number;
  totalErrors: number;
  errorRate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalSavedTokens: number;
  avgLatencyMs: number;
  byModel: Record<string, { requests: number; inputTokens: number; outputTokens: number; avgLatencyMs: number; errors: number }>;
  byProvider: Record<string, { requests: number; inputTokens: number; outputTokens: number; avgLatencyMs: number; errors: number }>;
  byScenario: Record<string, { requests: number; inputTokens: number; outputTokens: number; avgLatencyMs: number; errors: number }>;
}

export interface ProviderHealth {
  name: string;
  status: "online" | "offline" | "slow";
  latencyMs: number;
  lastChecked: string;
  models: string[];
}

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
