import type { ProviderCapabilities, ProviderCategory } from '../types';

export interface ProviderTemplate {
  id: string;
  label: string;
  category: ProviderCategory;
  icon: string;
  description: string;
  api_base_url: string;
  api_key_env: string;
  api_key_placeholder: string;
  api_key_required: boolean;
  default_models: string[];
  transformer?: string;
  capabilities: ProviderCapabilities;
  docs_url: string;
  pricing_hint: string;
  pricing?: {
    inputPer1MTokens: number;   // USD
    outputPer1MTokens: number;
  };
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'anthropic-pro',
    label: 'Anthropic Pro',
    category: 'cloud-subscription',
    icon: '🔮',
    description: 'Claude Opus/Sonnet/Haiku via direct Anthropic API',
    api_base_url: 'https://api.anthropic.com/v1/messages',
    api_key_env: 'ANTHROPIC_API_KEY',
    api_key_placeholder: 'sk-ant-...',
    api_key_required: true,
    default_models: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    transformer: 'anthropic',
    capabilities: { vision: true, streaming: true, functionCalling: true, thinking: true },
    docs_url: 'https://docs.anthropic.com/api',
    pricing_hint: 'Subscription required',
    pricing: {
      inputPer1MTokens: 15,
      outputPer1MTokens: 75,
    },
  },
  {
    id: 'codex-pro',
    label: 'Codex Pro (OpenAI)',
    category: 'cloud-subscription',
    icon: '🤖',
    description: 'OpenAI o3, o4-mini, codex-mini via Codex Pro subscription',
    api_base_url: 'https://api.openai.com/v1/chat/completions',
    api_key_env: 'OPENAI_API_KEY',
    api_key_placeholder: 'sk-...',
    api_key_required: true,
    default_models: ['o4-mini', 'o3', 'codex-mini', 'gpt-4.1', 'gpt-4.1-mini'],
    transformer: undefined,
    capabilities: { vision: true, streaming: true, functionCalling: true, thinking: true },
    docs_url: 'https://platform.openai.com/docs',
    pricing_hint: 'Codex Pro subscription',
    pricing: {
      inputPer1MTokens: 1.10,
      outputPer1MTokens: 4.40,
    },
  },
  {
    id: 'gemini-pro',
    label: 'Gemini Pro',
    category: 'cloud-subscription',
    icon: '♊',
    description: 'Gemini 2.5 Pro/Flash via Google AI Studio',
    api_base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    api_key_env: 'GOOGLE_API_KEY',
    api_key_placeholder: 'AIza...',
    api_key_required: true,
    default_models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    transformer: 'gemini',
    capabilities: { vision: true, streaming: true, functionCalling: true, thinking: true },
    docs_url: 'https://ai.google.dev/api',
    pricing_hint: 'Google AI Studio / Gemini Pro subscription',
    pricing: {
      inputPer1MTokens: 1.25,
      outputPer1MTokens: 10,
    },
  },
  {
    id: 'zai-coding',
    label: 'z.ai',
    category: 'cloud-subscription',
    icon: '⚡',
    description: 'GLM-Z1 models via z.ai coding plans',
    api_base_url: 'https://api.z.ai/v1/chat/completions',
    api_key_env: 'ZAPIKEY',
    api_key_placeholder: 'zai-...',
    api_key_required: true,
    default_models: ['glm-z1-rumination', 'glm-z1-air', 'glm-z1-9b'],
    transformer: undefined,
    capabilities: { vision: false, streaming: true, functionCalling: true, thinking: true },
    docs_url: 'https://z.ai/docs',
    pricing_hint: 'z.ai Coding plan subscription',
    pricing: {
      inputPer1MTokens: 0,
      outputPer1MTokens: 0,
    },
  },
  {
    id: 'opencode-go',
    label: 'opencode go (local)',
    category: 'local',
    icon: '🐳',
    description: 'Local Docker proxy — free, no auth required',
    api_base_url: 'http://localhost:8083/v1/chat/completions',
    api_key_env: '',
    api_key_placeholder: 'opencode-go',
    api_key_required: false,
    default_models: ['glm-5.1', 'devstral-2'],
    transformer: undefined,
    capabilities: { vision: false, streaming: true, functionCalling: true, thinking: false },
    docs_url: 'https://opencode.ai/docs/go',
    pricing_hint: 'Free - Docker required',
    pricing: {
      inputPer1MTokens: 0,
      outputPer1MTokens: 0,
    },
  },
  {
    id: 'opencode-zen',
    label: 'opencode zen',
    category: 'cloud-subscription',
    icon: '🧘',
    description: 'opencode.ai zen proxy — multiple model access',
    api_base_url: 'https://api.opencode.ai/v1/chat/completions',
    api_key_env: 'OPENCODE_API_KEY',
    api_key_placeholder: 'oc-...',
    api_key_required: true,
    default_models: ['minimax-m2.7', 'kimi-k2.6', 'glm-5.1'],
    transformer: undefined,
    capabilities: { vision: true, streaming: true, functionCalling: true, thinking: true },
    docs_url: 'https://opencode.ai/docs',
    pricing_hint: 'opencode zen subscription',
    pricing: {
      inputPer1MTokens: 0,
      outputPer1MTokens: 0,
    },
  },
  {
    id: 'ollama-local',
    label: 'Ollama (local)',
    category: 'local',
    icon: '🦙',
    description: 'Local Ollama instance — free, runs on your machine',
    api_base_url: 'http://localhost:11434/v1/chat/completions',
    api_key_env: '',
    api_key_placeholder: 'ollama',
    api_key_required: false,
    default_models: ['llama3.3', 'qwen3', 'devstral'],
    transformer: undefined,
    capabilities: { vision: true, streaming: true, functionCalling: true, thinking: false },
    docs_url: 'https://ollama.com',
    pricing_hint: 'Free - GPU required',
    pricing: {
      inputPer1MTokens: 0,
      outputPer1MTokens: 0,
    },
  },
  {
    id: 'openrouter',
    label: 'OpenRouter ⭐',
    category: 'cloud-api',
    icon: '🔀',
    description: 'Access 100+ models with one API key - best fallback option',
    api_base_url: 'https://openrouter.ai/api/v1/chat/completions',
    api_key_env: 'OPENROUTER_API_KEY',
    api_key_placeholder: 'sk-or-...',
    api_key_required: true,
    default_models: ['anthropic/claude-sonnet-4-6', 'openai/o4-mini', 'google/gemini-2.5-pro', 'deepseek/deepseek-r2'],
    transformer: undefined,
    capabilities: { vision: true, streaming: true, functionCalling: true, thinking: true },
    docs_url: 'https://openrouter.ai/docs',
    pricing_hint: 'Pay-per-token, no subscription',
    pricing: {
      inputPer1MTokens: 1.10,
      outputPer1MTokens: 4.40,
    },
  },
  {
    id: 'deepseek',
    label: 'DeepSeek ⭐',
    category: 'cloud-api',
    icon: '🔍',
    description: 'DeepSeek R2/V3 - excellent code performance at very low cost',
    api_base_url: 'https://api.deepseek.com/v1/chat/completions',
    api_key_env: 'DEEPSEEK_API_KEY',
    api_key_placeholder: 'sk-...',
    api_key_required: true,
    default_models: ['deepseek-r2', 'deepseek-v3', 'deepseek-coder-v3'],
    transformer: undefined,
    capabilities: { vision: false, streaming: true, functionCalling: true, thinking: true },
    docs_url: 'https://platform.deepseek.com/docs',
    pricing_hint: '~$0.14/1M tokens input',
    pricing: {
      inputPer1MTokens: 0.14,
      outputPer1MTokens: 0.28,
    },
  },
  {
    id: 'groq',
    label: 'Groq ⭐',
    category: 'cloud-api',
    icon: '⚡',
    description: 'Ultra-fast inference — ideal for background/quick tasks',
    api_base_url: 'https://api.groq.com/openai/v1/chat/completions',
    api_key_env: 'GROQ_API_KEY',
    api_key_placeholder: 'gsk_...',
    api_key_required: true,
    default_models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    transformer: undefined,
    capabilities: { vision: false, streaming: true, functionCalling: true, thinking: false },
    docs_url: 'https://console.groq.com/docs',
    pricing_hint: 'Free tier + pay-per-token',
    pricing: {
      inputPer1MTokens: 0.59,
      outputPer1MTokens: 0.79,
    },
  },
];
