/**
 * Orchestrator Router (v6 — fully config-driven)
 *
 * All routing thresholds and model lists are read from config.json.
 * No hardcoded model names or thresholds — change config.json to tune behavior.
 *
 * Config.json structure:
 *   Router.default, think, code, codeReview, background, image, longContext
 *   Router.haikuModels: string[] — models treated as haiku (fast path)
 *   Router.longContextThreshold: number — token count to trigger longContext
 *   Router.priorityOrder: string[] — route priority order
 */

// ---- ANALYSIS PATTERNS (regex, not hardcoded routing) ----
const CLASSIFICATION_PATTERNS = [
  { type: 'codeGeneration', re: /เขี?ยนโค[้้๊็]?ด|เขี?ยน function|เขี?ยน code|creat[ei]|implement|build|generat[ei]|make a function|creat[ei] component|เขี?ยนฟังก์ชัน|cod[ei] gen/i },
  { type: 'debugging', re: /แก้บั๊[ก้๊]|debu[gq]|\bbug\b|\bcrash\b|\bfail\b|fix bug|err[oer]r|ไม่ทำงาน|พัง|brok[ei]n|stack trac[ek]|except[i1]on|แก้บัก|ดีบัก|แก้ไขบั๊ก/i },
  { type: 'refactoring', re: /refactor|ปรับปรุงโค[้้๊]ด|clean up|restructur[eo]|optim[iy]z|รีแฟคเ?ตอร์/i },
  { type: 'explanation', re: /อธิบาย|explain|how does|ทำงานยังไง|คืออะไร|explain[ei]d|what is/i },
  { type: 'planning', re: /plan[sned]?|วางแผน|design|architectur[ea]|strateg[yi]|roadmap|spec/i },
  { type: 'testing', re: /test[singed]*|เขี?ยนเทส|unit test|integration test|e2e|coverage|เทส/i },
  { type: 'documentation', re: /document|เขี?ยน doc|README|comment|api doc|เขี?ยนเอกสาร/i },
  { type: 'codeReview', re: /review|ตรวจโค[้้๊]ด|code review|audit|security review|หาจุดปรับปรุง|รีวิว/i },
  { type: 'dataAnalysis', re: /analy[sz]e? data|วิเคราะห์ข้อมูล|data insight|วิเคราะห์/i },
  { type: 'creative', re: /creative|เขี?ยนเรื่อง|story|poem|content/i },
];

const SIMPLE_QUERY_RE = /^what is|^who is|^when|^where|^define|^list|^show me|^find|^คืออะไร|^อะไรคือ/i;

// Default config values (overridden by config.json Router section)
const DEFAULTS = {
  haikuModels: ['haiku', 'gemini-3-flash', 'qwen3.5'],
  longContextThreshold: 40000,
  priorityOrder: ['haiku', 'image', 'longContext', 'codeReview', 'planning', 'code', 'simple'],
  opusKeyword: 'deepseek',
};

function isHaikuModel(model, haikuList) {
  const m = model.toLowerCase();
  return haikuList.some(h => m.includes(h.toLowerCase()));
}

function extractUserContent(req) {
  const messages = req.body?.messages;
  if (!Array.isArray(messages)) return '';
  const userMsgs = messages.filter(m => m.role === 'user');
  const userMsg = userMsgs[userMsgs.length - 1];
  if (!userMsg) return '';
  let raw = '';
  if (typeof userMsg.content === 'string') raw = userMsg.content;
  else if (Array.isArray(userMsg.content)) {
    raw = userMsg.content
      .filter(b => b?.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)
      .join('');
  }
  return raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

function classifyContent(content) {
  if (typeof content !== 'string' || content.length === 0) {
    return { type: 'general', isSimpleQuery: false };
  }
  const lower = content.toLowerCase();
  let type = 'general';
  for (const p of CLASSIFICATION_PATTERNS) {
    if (p.re.test(lower)) { type = p.type; break; }
    p.re.lastIndex = 0;
  }
  const isSimpleQuery = SIMPLE_QUERY_RE.test(content.trim());
  return { type, isSimpleQuery };
}

function hasImageContent(req) {
  const messages = req.body?.messages;
  if (!Array.isArray(messages)) return false;
  for (const msg of messages) {
    if (Array.isArray(msg?.content)) {
      for (const block of msg.content) {
        if ((block?.type === 'image' && block?.source) ||
            (block?.type === 'image_url' && block?.image_url)) return true;
      }
    }
  }
  return false;
}

const { estimateTokens } = require('./shared/token-estimator');

// Normalize slash-format routes to comma-format (backward compatibility)
function _normalizeRoute(route) {
  if (typeof route !== 'string') return route;
  return route.replace(/^([^/]+)\/(.+)$/, '$1,$2');
}

// Mask sensitive values in content preview before logging
function _sanitizePreview(content) {
  if (typeof content !== 'string') return content;
  const sensitiveRe = /((?:api_key|apiKey|authorization|password|token|secret|credential|bearer)"?)(\s*[:=]\s*|\s+)("[^"]*"|'[^']*'|[^\s,}]+(?:\s+[^\s,}]+)*)/gi;
  return content.replace(sensitiveRe, (match, key, sep) => key + (sep.trim() === '=' ? ': ' : sep) + '***MASKED***');
}

// Route mapping: analysisType → config key
const TYPE_TO_ROUTE = {
  codeGeneration: 'code',
  debugging: 'code',
  codeReview: 'codeReview',
  planning: 'think',
  refactoring: 'code',
  explanation: 'default',
  testing: 'code',
  documentation: 'default',
  dataAnalysis: 'default',
  creative: 'default',
  general: 'default',
};

module.exports = async function orchestratorRouter(req, config) {
  const rawModel = (req.body?.model || '').toLowerCase();
  const r = config?.Router || {};

  // Merge defaults with config
  const haikuModels = r.haikuModels || DEFAULTS.haikuModels;
  const longContextThreshold = r.longContextThreshold || DEFAULTS.longContextThreshold;
  const opusKeyword = r.opusKeyword || DEFAULTS.opusKeyword;

  // Normalize route values from config (slash → comma)
  const n = (key) => _normalizeRoute(r[key]);

  // ---- ANALYZE REQUEST ----
  const userContent = extractUserContent(req);
  const { type: analysisType, isSimpleQuery } = classifyContent(userContent);
  const hasImage = hasImageContent(req);
  const estimatedTokens = estimateTokens(userContent);

  req.log?.info({
    event: 'router_input',
    model: rawModel,
    analysisType,
    isSimpleQuery,
    hasImage,
    tokens: estimatedTokens,
    contentPreview: _sanitizePreview(userContent.substring(0, 100)),
  });

  // ---- ANTHROPIC MODEL DETECTION (before haiku fast path) ----
  if (rawModel.includes('claude-opus') && r.anthropicThink) {
    req.log?.info('Anthropic Opus → ' + n('anthropicThink'));
    return n('anthropicThink');
  }
  if (rawModel.includes('claude-sonnet') && r.anthropicCode) {
    req.log?.info('Anthropic Sonnet → ' + n('anthropicCode'));
    return n('anthropicCode');
  }
  if (rawModel.includes('claude-haiku') && r.anthropicFast) {
    req.log?.info('Anthropic Haiku → ' + n('anthropicFast'));
    return n('anthropicFast');
  }

  // ---- HAIKU FAST PATH ----
  if (isHaikuModel(rawModel, haikuModels) && r.background) {
    req.log?.info(`Haiku subagent (${rawModel}) → ${n('background')}`);
    return n('background');
  }

  // ---- CONTENT-BASED ROUTING (config-driven priority) ----
  // Image
  if (hasImage && r.image) {
    req.log?.info('Image detected → ' + n('image'));
    return n('image');
  }

  // Long context
  if (estimatedTokens > longContextThreshold && r.longContext) {
    req.log?.info(`Long context (${estimatedTokens} tokens) → ${n('longContext')}`);
    return n('longContext');
  }

  // Analysis-based routing
  const routeKey = TYPE_TO_ROUTE[analysisType] || 'default';
  if (routeKey !== 'default' && r[routeKey]) {
    // Special: planning falls back to codeReview if think not available
    if (analysisType === 'planning' && routeKey === 'think' && !r.think && r.codeReview) {
      req.log?.info('Planning (fallback to codeReview) → ' + n('codeReview'));
      return n('codeReview');
    }
    req.log?.info(`${analysisType} → ${routeKey}: ${n(routeKey)}`);
    return n(routeKey);
  }

  // Simple query → background
  if (isSimpleQuery && r.background) {
    req.log?.info('Simple query → background: ' + n('background'));
    return n('background');
  }

  // Opus-tier model (slow but high quality) → think route
  if (rawModel.includes(opusKeyword) && r.think) {
    req.log?.info(`Opus (${opusKeyword}) → ${n('think')}`);
    return n('think');
  }

  // Default
  const defaultRoute = n('default') || 'ollama,glm-5.1:cloud';
  req.log?.info('Default → ' + defaultRoute);
  return defaultRoute;
};

// Expose helpers for testing
module.exports._normalizeRoute = _normalizeRoute;
module.exports._sanitizePreview = _sanitizePreview;