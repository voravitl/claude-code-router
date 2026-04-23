/**
 * Smart Optimizer Transformer (v3 — LLM-powered dynamic optimization)
 *
 * Two-tier classification: LLM pre-flight (gemini-flash, free) → regex fallback
 * - LLM classifies + optimizes prompt for perfect results
 * - Regex as instant fallback if LLM fails/timeout
 * - FNV-1a hash caching (both regex and LLM results)
 * - reasoning_effort=none fix for all models
 * - History truncation, filler removal, token estimation
 */

const crypto = require('crypto');
const { classifyChars, estimateTokens: sharedEstimateTokens } = require('./shared/token-estimator');

const PREFLIGHT_MODEL = 'qwen3.5:cloud';
const PREFLIGHT_TIMEOUT_MS = 5000;

// Valid classification types
const VALID_TYPES = new Set([
  'codeGeneration', 'debugging', 'refactoring', 'explanation',
  'planning', 'testing', 'documentation', 'codeReview',
  'dataAnalysis', 'creative', 'general',
]);

const PREFLIGHT_SYSTEM = `You are a prompt classifier and optimizer for a coding AI assistant. You do NOT write code. You ONLY classify and improve the prompt text.

Given a user prompt, return ONLY a JSON object with 3 fields:
- "type": one of: codeGeneration, debugging, refactoring, explanation, planning, testing, documentation, codeReview, dataAnalysis, creative, general
- "optimized": a clearer, more specific version of the USER'S REQUEST. Do NOT write code. Just improve the request itself. Fix typos, add missing context, remove filler words. Keep original language (Thai stays Thai, English stays English). Be concise but specific.
- "isSimpleQuery": true only for simple factual questions like "what is X" or "define Y". false for anything that requires code, analysis, or multi-step thinking.

IMPORTANT: "optimized" must be an improved version of the USER'S REQUEST, not the answer to it.

Examples:
"เขียนโค้ด sort" → {"type":"codeGeneration","optimized":"Write a JavaScript function to sort an array of numbers in ascending order, handling edge cases for empty arrays and null values","isSimpleQuery":false}
"แก้บั๊ก API ไม่ทำงาน" → {"type":"debugging","optimized":"Debug API endpoint returning HTTP 500 error. Investigate: server logs, request payload validation, database connection, and authentication middleware","isSimpleQuery":false}
"คืออะไร closure" → {"type":"explanation","optimized":"Explain what a closure is in JavaScript with a practical example showing variable encapsulation","isSimpleQuery":true}
"ทำไมช้า" → {"type":"general","optimized":"Investigate and identify performance bottlenecks. Analyze: slow queries, memory usage, network latency, CPU profiling","isSimpleQuery":false}`;

// Regex fallback (kept for when LLM fails)
const CLASSIFICATION_PATTERNS = [
  { type: 'codeGeneration', re: /เขี?ยนโค[้้๊็]?ด|เขี?ยน function|เขี?ยน code|creat[ei]|implement|build|generat[ei]|make a function|creat[ei] component|เขี?ยนฟังก์ชัน|cod[ei] gen/i },
  { type: 'debugging', re: /แก้บั๊[ก้๊]|debu[gq]|fix bug|err[oer]r|ไม่ทำงาน|พัง|brok[ei]n|stack trac[ek]|except[i1]on|แก้บัก|ดีบัก|แก้ไขบั๊ก/i },
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

const THAI_FILLERS = ['กรุณา', 'โปรด', 'ช่วย', 'หน่อยครับ', 'หน่อยค่ะ',
  'อยากให้เป็น', 'ต้องการให้', 'ผมต้องการ', 'ฉันต้องการ'];
const ENGLISH_FILLERS = ['please ', 'kindly ', 'i would like ', 'i want you to ',
  'could you ', 'would you ', 'i need you to '];

const THAI_FILLER_RES = THAI_FILLERS.map(w => new RegExp(w, 'g'));
const ENGLISH_FILLER_RES = ENGLISH_FILLERS.map(p => new RegExp(p, 'gi'));

const WHITESPACE_RE = /\n{3,}/g;
const WHITESPACE_TAB_RE = /[ \t]+/g;
const CODE_BLOCK_RE = /```[\s\S]*?```/g;

const ROLE_PROMPTS = {
  codeGeneration: "You are an expert software engineer. Write production-ready, well-tested, maintainable code.",
  debugging: "You are a senior debugging specialist. Analyze errors methodically and provide clear fixes.",
  refactoring: "You are a code quality expert specializing in refactoring and SOLID principles.",
  explanation: "You are a skilled technical educator who explains complex concepts clearly.",
  planning: "You are a software architect with expertise in system design and trade-off analysis.",
  testing: "You are a QA engineering expert specializing in comprehensive test strategies.",
  documentation: "You are a technical writing specialist who creates clear, concise documentation.",
  codeReview: "You are a senior code reviewer. Provide constructive, actionable feedback.",
  dataAnalysis: "You are a data science expert skilled in statistical analysis and data visualization.",
  creative: "You are a creative writer with expertise in engaging storytelling and clear communication.",
};

const COT_PROMPTS = {
  codeGeneration: '<thinking>\n1. Understand requirements\n2. Consider edge cases\n3. Design solution\n4. Implement\n5. Review\n</thinking>',
  debugging: '<thinking>\n1. Analyze error message\n2. Identify root causes\n3. Formulate hypotheses\n4. Test systematically\n5. Provide fix\n</thinking>',
  planning: '<thinking>\n1. Understand problem\n2. Identify requirements\n3. Consider approaches\n4. Evaluate trade-offs\n5. Recommend\n</thinking>',
  codeReview: '<thinking>\n1. Review structure\n2. Check security\n3. Evaluate performance\n4. Assess readability\n5. Suggest improvements\n</thinking>',
};


function estimateTokensFromClassification(thai, english, other) {
  return Math.ceil(thai * 0.8 + english * 0.25 + other * 1.0);
}

// Deprecated: use sharedEstimateTokens from shared/token-estimator.js
// Kept for internal analyzeContent() compatibility

module.exports = class SmartOptimizerTransformer {
  constructor(options = {}) {
    this.name = "smart-optimizer";
    this.options = {
      maxContextTokens: 100000,
      compressionThreshold: 0.8,
      enableRolePrompt: true,
      enableStructuredPrompt: true,
      enableChainOfThought: true,
      enableCompression: true,
      enableTokenCounting: true,
      enableHistoryTruncation: true,
      preserveSystemPrompt: true,
      enableLLMOptimization: true,
      llmModel: PREFLIGHT_MODEL,
      llmBaseUrl: null,
      llmTimeoutMs: PREFLIGHT_TIMEOUT_MS,
      llmMinLength: 5,
      tokenCacheMaxSize: 500,
      analysisCacheMaxSize: 200,
      llmCacheMaxSize: 300,
      enableToolPruning: true,
      toolPruningMaxAge: 5,
      toolPruningHandlers: {},
      enableDistillation: true,
      distillationThreshold: 0.9, // summarize if over 90% of budget
      enableAntiLoop: true,
      antiLoopWindow: 3,
      ...options,
    };

    this._llmBaseUrl = this.options.llmBaseUrl || this._detectProviderUrl();

    if (typeof this.options.maxContextTokens !== 'number' || this.options.maxContextTokens <= 0) {
      this.options.maxContextTokens = 100000;
    }
    if (typeof this.options.compressionThreshold !== 'number' ||
        this.options.compressionThreshold <= 0 || this.options.compressionThreshold > 1) {
      this.options.compressionThreshold = 0.8;
    }

    this.tokenStats = { totalRequests: 0, totalTokens: 0, savedTokens: 0, llmHits: 0, llmMisses: 0, _resetAt: 0 };
    this._tokenCache = new Map();
    this._analysisCache = new Map();
    this._llmCache = new Map();
  }

  _hashContent(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  // ---- LLM PRE-FLIGHT OPTIMIZATION (async cache-warm) ----
  async llmOptimize(content) {
    if (!this.options.enableLLMOptimization) return null;
    if (typeof content !== 'string' || content.length < this.options.llmMinLength) return null;

    const hash = this._hashContent(content);
    if (this._llmCache.has(hash)) {
      this.tokenStats.llmHits++;
      return this._llmCache.get(hash);
    }

    // Return null immediately — don't block the request
    // Fire background LLM call to warm cache for next time
    this._warmLLMCache(content, hash);
    this.tokenStats.llmMisses++;
    return null;
  }

  // Fire-and-forget LLM call to populate cache
  _warmLLMCache(content, hash) {
    // Prevent duplicate in-flight calls for same content
    if (this._inflightLLM?.has(hash)) return;
    if (!this._inflightLLM) this._inflightLLM = new Set();
    this._inflightLLM.add(hash);

    // Hard timeout: ensure inflight is cleared even if fetch never settles
    const hardCleanup = setTimeout(() => {
      this._inflightLLM.delete(hash);
    }, this.options.llmTimeoutMs * 2);
    hardCleanup.unref?.();

    const baseUrl = this._llmBaseUrl || this._detectProviderUrl();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.llmTimeoutMs);

    fetch(baseUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.options.llmModel,
        messages: [
          { role: 'system', content: PREFLIGHT_SYSTEM },
          { role: 'user', content: content.substring(0, 2000) },
        ],
        max_tokens: 300,
        temperature: 0.1,
        reasoning_effort: 'none',
      }),
    })
    .then(res => res.json())
    .then(data => {
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (!text) return;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;
      const parsed = JSON.parse(jsonMatch[0]);
      const type = VALID_TYPES.has(parsed.type) ? parsed.type : null;
      if (!type) return;
      const result = {
        type,
        optimized: typeof parsed.optimized === 'string' && parsed.optimized.length > 0
          ? parsed.optimized : null,
        isSimpleQuery: typeof parsed.isSimpleQuery === 'boolean' ? parsed.isSimpleQuery : false,
      };
      this._llmCache.set(hash, result);
      if (this._llmCache.size > this.options.llmCacheMaxSize) {
        const firstKey = this._llmCache.keys().next().value;
        this._llmCache.delete(firstKey);
      }
    })
    .catch(() => {}) // silently fail — regex fallback handles it
    .finally(() => {
      clearTimeout(timeoutId);
      clearTimeout(hardCleanup);
      this._inflightLLM.delete(hash);
    });
  }

  _detectProviderUrl() {
    try {
      const path = require('path');
      const os = require('os');
      const config = require(path.join(os.homedir(), '.claude-code-router', 'config.json'));
      const provider = config.Providers?.find(p => p.name === 'ollama');
      return provider?.api_base_url || 'http://localhost:11434/v1/chat/completions';
    } catch { return 'http://localhost:11434/v1/chat/completions'; }
  }

  // ---- REGEX FALLBACK ANALYSIS ----
  analyzeContent(content) {
    if (typeof content !== 'string' || content.length === 0) {
      return { type: 'general', isSimpleQuery: false, estimatedTokens: 0,
        thai: 0, english: 0, other: 0, hasImage: false };
    }

    const hash = this._hashContent(content);
    if (this._analysisCache.has(hash)) return this._analysisCache.get(hash);

    const charInfo = classifyChars(content); // uses imported shared function
    const lower = content.toLowerCase();

    let type = 'general';
    const flags = {};
    for (const p of CLASSIFICATION_PATTERNS) {
      const match = p.re.test(lower);
      flags[`is${p.type.charAt(0).toUpperCase()}${p.type.slice(1)}`] = match;
      if (match && type === 'general') type = p.type;
      p.re.lastIndex = 0;
    }

    const isSimpleQuery = SIMPLE_QUERY_RE.test(content.trim());
    SIMPLE_QUERY_RE.lastIndex = 0;

    const result = {
      type,
      ...flags,
      isSimpleQuery,
      estimatedTokens: estimateTokensFromClassification(charInfo.thai, charInfo.english, charInfo.other),
      thai: charInfo.thai,
      english: charInfo.english,
      other: charInfo.other,
      hasImage: false,
    };

    this._analysisCache.set(hash, result);
    if (this._analysisCache.size > this.options.analysisCacheMaxSize) {
      const firstKey = this._analysisCache.keys().next().value;
      this._analysisCache.delete(firstKey);
    }

    return result;
  }

  // ---- IMAGE DETECTION ----
  scanForImages(messages) {
    if (!Array.isArray(messages)) return false;
    try {
      for (const msg of messages) {
        if (Array.isArray(msg?.content)) {
          for (const block of msg.content) {
            if ((block?.type === "image" && block?.source) ||
                (block?.type === "image_url" && block?.image_url)) return true;
          }
        }
      }
    } catch (_) {}
    return false;
  }

  // ---- CACHED TOKEN ESTIMATION ----
  estimateTokens(text) {
    if (typeof text !== 'string' || text.length === 0) return 0;
    const hash = this._hashContent(text);
    if (this._tokenCache.has(hash)) return this._tokenCache.get(hash);
    const tokens = sharedEstimateTokens(text);
    this._tokenCache.set(hash, tokens);
    if (this._tokenCache.size > this.options.tokenCacheMaxSize) {
      const firstKey = this._tokenCache.keys().next().value;
      this._tokenCache.delete(firstKey);
    }
    return tokens;
  }

  // ---- SAFE CONTENT EXTRACTION ----
  extractContent(message) {
    if (!message) return '';
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      let total = '';
      for (const block of message.content) {
        if (block?.type === 'text' && typeof block.text === 'string') total += block.text;
      }
      return total;
    }
    return '';
  }

  // ---- XML ESCAPING ----
  _escapeXml(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- FILLER REMOVAL ----
  removeFillers(text) {
    if (typeof text !== 'string') return text;
    let result = text;
    for (const re of THAI_FILLER_RES) result = result.replace(re, '');
    for (const re of ENGLISH_FILLER_RES) result = result.replace(re, '');
    return result;
  }

  // ---- COMPRESS TEXT ----
  compressText(text, targetTokens) {
    if (!this.options.enableCompression || typeof text !== 'string') return text;
    let compressed = text.replace(WHITESPACE_RE, '\n\n').replace(WHITESPACE_TAB_RE, ' ');
    compressed = this.removeFillers(compressed);
    const codeBlocks = compressed.match(CODE_BLOCK_RE) || [];
    CODE_BLOCK_RE.lastIndex = 0;
    for (const block of codeBlocks) {
      const blockTokens = this.estimateTokens(block);
      if (blockTokens > targetTokens * 0.3) {
        const lines = block.split('\n');
        if (lines.length > 20) {
          const summary = [lines.slice(0, 5).join('\n'), '```',
            `// ... ${lines.length - 10} lines omitted ...`, '```',
            lines.slice(-5).join('\n')].join('\n');
          compressed = compressed.replace(block, summary);
        }
      }
    }
    return compressed.trim();
  }

  /**
   * Prune old tool outputs by replacing them with 1-line summaries.
   * Called before truncateHistory() to preserve context while saving tokens.
   */
  _pruneToolOutputs(messages) {
    if (!this.options.enableToolPruning || !Array.isArray(messages)) return messages;

    const maxAge = this.options.toolPruningMaxAge || 5;

    // Map tool_call_id to tool name from assistant messages
    const toolNames = new Map();
    for (const msg of messages) {
      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (tc.id && tc.function?.name) {
            toolNames.set(tc.id, tc.function.name);
          }
        }
      }
    }

    const handlers = {
      terminal: (result) => {
        const exitMatch = result.match(/exit\s*(\d+)/i);
        const lines = (result.match(/\n/g) || []).length;
        return `[terminal] exit ${exitMatch ? exitMatch[1] : '?'}, ${lines} lines`;
      },
      read_file: (result) => {
        const lines = (result.match(/\n/g) || []).length;
        const chars = result.length;
        return `[read_file] ${chars} chars, ${lines} lines`;
      },
      write_file: (result) => {
        const chars = result.length;
        return `[write_file] ${chars} chars written`;
      },
      search_files: (result) => {
        const matches = (result.match(/\n/g) || []).length;
        return `[search_files] ${matches} results`;
      },
      patch: () => {
        return `[patch] applied`;
      },
      ...this.options.toolPruningHandlers
    };

    // Process messages in reverse to count age from the end
    const reversed = [...messages].reverse();
    const processed = [];
    let turnFromEnd = 0;

    for (let i = 0; i < reversed.length; i++) {
      const msg = reversed[i];
      const toolName = msg.tool_call_id ? toolNames.get(msg.tool_call_id) : msg.name;

      if (msg.role === 'tool' && toolName && turnFromEnd >= maxAge) {
        const handler = handlers[toolName] || handlers[toolName.split('/')[0]] || ((content) => `[${toolName}] (${content.length} chars)`);
        const content = this.extractContent(msg);
        if (typeof content === 'string' && content.length > 200) {
          processed.push({
            ...msg,
            content: handler(content),
            _pruned: true
          });
        } else {
          processed.push(msg);
        }
      } else {
        processed.push(msg);
      }

      if (msg.role === 'assistant' || msg.role === 'user') {
        turnFromEnd++;
      }
    }

    // Reverse back to original order
    return processed.reverse();
  }

  // ---- LLM DISTILLATION (P3-L2) ----
  async _distillHistory(messages, targetTokens) {
    if (!this.options.enableDistillation || !Array.isArray(messages) || messages.length < 10) return messages;

    const systemMessages = messages.filter(m => m.role === 'system');
    const conversation = messages.filter(m => m.role !== 'system');

    // Check for existing summary
    const summaryIndex = conversation.findIndex(m =>
      m._distilled === true ||
      (typeof m.content === 'string' && m.content.includes('<ccr-context-summary>'))
    );

    if (summaryIndex >= 0) {
      // Iterative summarization: only summarize new turns after existing summary
      const prefix = conversation.slice(0, summaryIndex);
      const existingSummaryMsg = conversation[summaryIndex];
      const existingSummaryMatch = this.extractContent(existingSummaryMsg).match(/<ccr-context-summary>\n?([\s\S]*?)\n?<\/ccr-context-summary>/);
      const existingSummary = existingSummaryMatch ? existingSummaryMatch[1].trim() : '';

      const newTurns = conversation.slice(summaryIndex + 1);
      if (newTurns.length < 4) return messages; // Not enough new content to summarize

      // Keep last 8 of new turns as footer, distill the rest
      const footerNew = newTurns.slice(-8);
      const toDistillNew = newTurns.slice(0, -8);

      if (toDistillNew.length < 1) return messages;

      const serializedNew = toDistillNew.map(m => `[${m.role.toUpperCase()}]: ${this.extractContent(m)}`).join('\n\n');

      const summary = await this._runSummarizer(serializedNew, existingSummary);
      if (!summary) return messages;

      const summaryMessage = {
        role: 'user',
        content: `<ccr-context-summary>\n${summary}\n</ccr-context-summary>`,
        _distilled: true
      };

      return [...systemMessages, ...prefix, summaryMessage, ...footerNew];
    }

    // Fallback: original full summarization behavior
    const firstMessage = conversation[0];
    const footer = conversation.slice(-8);
    const toDistill = conversation.slice(1, -8);

    if (toDistill.length < 4) return messages;

    // Serialize toDistill for the summarizer
    const serialized = toDistill.map(m => `[${m.role.toUpperCase()}]: ${this.extractContent(m)}`).join('\n\n');

    const summary = await this._runSummarizer(serialized);
    if (!summary) return messages;

    const summaryMessage = {
      role: 'user',
      content: `<ccr-context-summary>\n${summary}\n</ccr-context-summary>`,
      _distilled: true
    };

    return [...systemMessages, firstMessage, summaryMessage, ...footer];
  }

  async _runSummarizer(text, existingSummary = '') {
    const baseUrl = this._llmBaseUrl || this._detectProviderUrl();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const prompt = existingSummary
      ? `You are a conversation distiller. You have an existing summary of prior conversation. Update it by incorporating the new turns below. Produce a single comprehensive 13-section handoff document. Include: goals, technical decisions, current state, pending tasks, discovered bugs, and critical code context. Be extremely dense and technical.\n\nExisting summary:\n${existingSummary}\n\nNew conversation turns:\n${text.substring(0, 15000)}`
      : `You are a conversation distiller. Summarize the following coding conversation into a structured 13-section handoff document for a fresh AI agent. Include: goals, technical decisions, current state, pending tasks, discovered bugs, and critical code context. Be extremely dense and technical.\n\nConversation:\n${text.substring(0, 15000)}`;

    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.options.llmModel,
          messages: [
            { role: 'system', content: 'You are a dense technical summarizer. Use 13 structured sections.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 1000,
          temperature: 0.1,
        }),
      });

      const data = await response.json();
      return data?.choices?.[0]?.message?.content?.trim() || null;
    } catch (e) {
      console.error('Distillation failed:', e.message);
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ---- ANTI-LOOP DETECTION ----
  _detectLoop(messages) {
    if (!this.options.enableAntiLoop || !Array.isArray(messages)) return false;

    const window = this.options.antiLoopWindow || 3;
    const recentToolCalls = [];

    for (let i = messages.length - 1; i >= 0 && recentToolCalls.length < window; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          recentToolCalls.unshift({
            name: tc.function?.name,
            args: tc.function?.arguments,
          });
        }
      }
    }

    if (recentToolCalls.length >= window) {
      const allSame = recentToolCalls.every(tc =>
        tc.name === recentToolCalls[0].name &&
        tc.args === recentToolCalls[0].args
      );
      if (allSame) {
        messages.push({
          role: 'user',
          content: `[CCR Loop Detection] You have called ${recentToolCalls[0].name} ${window} times with the same arguments. This may indicate a loop. Try a different approach or tool.`,
        });
        return true;
      }
    }
    return false;
  }

  // ---- TRUNCATE HISTORY ----
  truncateHistory(messages, maxTokens) {
    if (!this.options.enableHistoryTruncation || !Array.isArray(messages)) return messages;
    let totalTokens = 0;
    const systemMessages = [];
    const otherMessages = [];
    for (const message of messages) {
      if (message.role === 'system') {
        systemMessages.push(message);
        totalTokens += this.estimateTokens(this.extractContent(message));
      } else {
        otherMessages.push(message);
      }
    }
    const preserved = [...systemMessages];
    // Keep first user message (often contains code context)
    const firstUserIdx = otherMessages.findIndex(m => m.role === 'user');
    if (firstUserIdx >= 0) {
      const firstUserMsg = otherMessages.splice(firstUserIdx, 1)[0];
      preserved.push(firstUserMsg);
      totalTokens += this.estimateTokens(this.extractContent(firstUserMsg));
    }
    const toKeep = [];
    for (let i = otherMessages.length - 1; i >= 0; i--) {
      const msg = otherMessages[i];
      const tokens = this.estimateTokens(this.extractContent(msg));
      if (totalTokens + tokens <= maxTokens) {
        toKeep.unshift(msg);
        totalTokens += tokens;
      } else {
        const remaining = maxTokens - totalTokens;
        if (remaining > 100) {
          const content = this.extractContent(msg);
          const compressed = this.compressText(content, remaining);
          toKeep.unshift({ ...msg, content: compressed, _compressed: true });
          totalTokens += this.estimateTokens(compressed);
        }
        break;
      }
    }
    return [...preserved, ...toKeep];
  }

  /**
   * Sanitize tool call/result pairs after truncation.
   * Fixes bilateral orphans:
   *  - Forward orphan: tool_call without tool_result → insert stub result
   *  - Backward orphan: tool_result without tool_call → remove result
   */
  _sanitizeToolPairs(messages) {
    // Collect all tool_call IDs from assistant messages
    const toolCallIds = new Set();
    for (const msg of messages) {
      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          toolCallIds.add(tc.id);
        }
      }
    }

    // Collect all tool_result IDs
    const toolResultIds = new Set();
    for (const msg of messages) {
      if (msg.role === 'tool' && msg.tool_call_id) {
        toolResultIds.add(msg.tool_call_id);
      }
    }

    // Remove backward orphans (tool_result without matching tool_call)
    const filtered = messages.filter(msg => {
      if (msg.role === 'tool' && msg.tool_call_id) {
        return toolCallIds.has(msg.tool_call_id);
      }
      return true;
    });

    // Insert stub tool_results for forward orphans (tool_call without result)
    const resultToolResultIds = new Set();
    for (const msg of filtered) {
      if (msg.role === 'tool' && msg.tool_call_id) {
        resultToolResultIds.add(msg.tool_call_id);
      }
    }

    const result = [];
    for (const msg of filtered) {
      result.push(msg);
      // After assistant messages with tool_calls, insert stubs for missing results
      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (!resultToolResultIds.has(tc.id)) {
            result.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: '[Result from earlier conversation — see context summary above]'
            });
          }
        }
      }
    }

    return result;
  }

  // ---- ROLE PROMPT ----
  generateRolePrompt(requestType) {
    return ROLE_PROMPTS[requestType] || ROLE_PROMPTS.explanation;
  }

  // ---- STRUCTURE PROMPT ----
  structurePrompt(content, requestType) {
    let structured = '';
    if (this.options.enableRolePrompt) {
      structured += `<ccr-role>\n${this.generateRolePrompt(requestType)}\n</ccr-role>\n\n`;
    }
    if (this.options.enableChainOfThought &&
        ['codeGeneration', 'debugging', 'planning', 'codeReview'].includes(requestType)) {
      structured += `${COT_PROMPTS[requestType]}\n\n`;
    }
    structured += `<ccr-task>\n${this._escapeXml(content)}\n</ccr-task>`;
    return structured;
  }

  // ---- MAIN ENTRY POINT ----
  async transformRequestIn(request, provider, context) {
    if (!request.messages || !Array.isArray(request.messages)) return request;

    const userMessages = request.messages.filter(m => m.role === 'user');
    const userMessage = userMessages[userMessages.length - 1] || null;
    const userContent = userMessage ? this.extractContent(userMessage) : '';

    // 1. Try LLM pre-flight optimization first
    const llmResult = await this.llmOptimize(userContent);
    let analysis;
    let optimizedContent = null;

    if (llmResult) {
      // LLM succeeded — use its classification and optimized prompt
      analysis = this.analyzeContent(userContent); // still run for token estimation
      analysis.type = llmResult.type;
      analysis.isSimpleQuery = llmResult.isSimpleQuery;
      optimizedContent = llmResult.optimized;
      if (context?.logger) {
        context.logger.info({ event: 'llm_optimization', type: llmResult.type, optimized: true });
      }
    } else {
      // LLM failed — use regex fallback
      analysis = this.analyzeContent(userContent);
      if (context?.logger) {
        context.logger.info({ event: 'llm_optimization', type: 'fallback', optimized: false });
      }
    }

    analysis.hasImage = this.scanForImages(request.messages);

    // 2. Estimate total tokens
    let totalTokens = 0;
    for (const message of request.messages) {
      totalTokens += this.estimateTokens(this.extractContent(message));
    }

    // 3. Stats
    this.tokenStats.totalRequests++;
    this.tokenStats.totalTokens += totalTokens;
    if (this.tokenStats.totalRequests >= 1000000) {
      this.tokenStats = { totalRequests: 0, totalTokens: 0, savedTokens: 0, llmHits: 0, llmMisses: 0, _resetAt: Date.now() };
    }

    // 4. Anti-loop detection
    this._detectLoop(request.messages);

    // 5. Truncation if over threshold
    const thresholdTokens = this.options.maxContextTokens * this.options.compressionThreshold;
    const distillationThreshold = this.options.maxContextTokens * (this.options.distillationThreshold || 0.9);

    if (totalTokens > thresholdTokens) {
      const originalTokens = totalTokens;

      // L1: Prune old tool outputs
      if (this.options.enableToolPruning) {
        request.messages = this._pruneToolOutputs(request.messages);
      }

      // L2: LLM Distillation (if still over budget and enabled)
      if (totalTokens > distillationThreshold && this.options.enableDistillation) {
        request.messages = await this._distillHistory(request.messages, thresholdTokens);
      }

      // L3: Hard truncation fallback
      request.messages = this.truncateHistory(request.messages, thresholdTokens);
      // Sanitize tool pairs after truncation
      request.messages = this._sanitizeToolPairs(request.messages);
      totalTokens = 0;
      for (const message of request.messages) {
        totalTokens += this.estimateTokens(this.extractContent(message));
      }
      this.tokenStats.savedTokens += (originalTokens - totalTokens);
      request._tokenOptimization = {
        originalTokens,
        optimizedTokens: totalTokens,
        savedTokens: originalTokens - totalTokens,
        wasTruncated: true,
        compressionRatio: ((originalTokens - totalTokens) / originalTokens * 100).toFixed(2) + '%',
      };
    }

    // 5. Structure prompt — use LLM-optimized content if available
    if (userMessage && this.options.enableStructuredPrompt && userContent.length > 0) {
      let content = optimizedContent || this.extractContent(userMessage);

      if (!optimizedContent && this.options.enableCompression) {
        content = this.removeFillers(content);
      }

      content = this.structurePrompt(content, analysis.type);

      if (typeof userMessage.content === 'string') {
        userMessage.content = content;
      } else if (Array.isArray(userMessage.content) && userMessage.content[0]?.type === 'text') {
        userMessage.content[0].text = content;
      }
    }

    // 6. Fix reasoning models — set reasoning_effort only if not already specified
    // by upstream (Hermes may set low/medium/high for adaptive reasoning).
    // Only apply default when no value is present.
    if (typeof request.reasoning_effort === 'undefined') {
      const effortOverride = this.options?.effortOverride || {};
      const modelBase = (request.model || '').split('|')[0].split(':')[0].toLowerCase();
      if (effortOverride[modelBase]) {
        request.reasoning_effort = effortOverride[modelBase];
      } else {
        request.reasoning_effort = 'none';
      }
    }

    // 8. Capture final stats for analytics
    let finalTokens = 0;
    for (const msg of request.messages) {
      finalTokens += this.estimateTokens(this.extractContent(msg));
    }

    if (!request._tokenOptimization) {
      request._tokenOptimization = {
        originalTokens: totalTokens,
        optimizedTokens: finalTokens,
        savedTokens: Math.max(0, totalTokens - finalTokens),
        wasTruncated: false,
        compressionRatio: totalTokens > 0 ? ((totalTokens - finalTokens) / totalTokens * 100).toFixed(2) + '%' : '0%',
      };
    } else {
      // Update savedTokens if it was already set by truncation but further optimized
      request._tokenOptimization.optimizedTokens = finalTokens;
      request._tokenOptimization.savedTokens = Math.max(0, request._tokenOptimization.originalTokens - finalTokens);
      request._tokenOptimization.compressionRatio = request._tokenOptimization.originalTokens > 0 
        ? ((request._tokenOptimization.originalTokens - finalTokens) / request._tokenOptimization.originalTokens * 100).toFixed(2) + '%' 
        : '0%';
    }

    return request;
  }

  getTokenStats() {
    const s = this.tokenStats;
    return {
      ...s,
      averageTokensPerRequest: s.totalRequests > 0
        ? Math.round(s.totalTokens / s.totalRequests) : 0,
      compressionSavings: s.savedTokens > 0
        ? ((s.savedTokens / s.totalTokens) * 100).toFixed(2) + '%' : '0%',
      llmCacheHitRate: s.llmHits + s.llmMisses > 0
        ? ((s.llmHits / (s.llmHits + s.llmMisses)) * 100).toFixed(1) + '%' : 'N/A',
    };
  }
};
