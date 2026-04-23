/**
 * Diff Inspector Transformer
 * Shows [Original Prompt] vs [CCR Optimized Prompt] side by side.
 * Highlights: added content, removed content, token count delta.
 * Writes diff to stderr (or log file) for DX visibility.
 *
 * Config:
 *   enabled: false          // opt-in — disable in production
 *   output: "stderr"        // "stderr" | "file"
 *   logFile: "/tmp/ccr-diff.log"
 *   showTokenDelta: true
 *   maxPreviewChars: 2000   // truncate long prompts in diff view
 */

const fs = require('fs');
const { estimateTokens } = require('./shared/token-estimator');

module.exports = class DiffInspectorTransformer {
  constructor(options = {}) {
    this.name = 'diff-inspector';
    this.options = {
      enabled: false,
      output: 'stderr',
      logFile: '/tmp/ccr-diff.log',
      showTokenDelta: true,
      maxPreviewChars: 2000,
      ...options,
    };
  }

  async transformRequestIn(request, provider, context) {
    if (!this.options.enabled) return request;
    // Snapshot original before any other transformer touches it
    if (!context) context = {};
    context._diffOriginal = JSON.parse(JSON.stringify(request));
    return request;
  }

  async transformRequestOut(request, provider, context) {
    if (!this.options.enabled) return request;
    const original = context?._diffOriginal;
    if (!original) return request;

    try {
      const diff = this._buildDiff(original, request);
      this._emit(diff);
    } catch (_) {
      // Never block the request on diff failure
    }
    return request;
  }

  async transformResponseOut(response, context) {
    return response;
  }

  // ─── diff builder ───────────────────────────────────────────────────────────

  _buildDiff(original, optimized) {
    const origText = this._serializeMessages(original.messages || []);
    const optText = this._serializeMessages(optimized.messages || []);

    const origTokens = estimateTokens(origText);
    const optTokens = estimateTokens(optText);
    const delta = optTokens - origTokens;
    const pct = origTokens > 0 ? Math.round((delta / origTokens) * 100) : 0;

    const lines = [
      '─'.repeat(72),
      '📋  CCR DIFF INSPECTOR',
      '─'.repeat(72),
      '',
      `[ORIGINAL]  ${origTokens} tokens`,
      this._preview(origText),
      '',
      `[OPTIMIZED] ${optTokens} tokens`,
      this._preview(optText),
      '',
    ];

    if (this.options.showTokenDelta) {
      const arrow = delta <= 0 ? '▼' : '▲';
      const sign = delta <= 0 ? '' : '+';
      lines.push(`Token delta: ${arrow} ${sign}${delta} (${sign}${pct}%)`);
      if (delta < 0) lines.push(`Savings: ${Math.abs(pct)}% 🎉`);
    }

    // Structural diff: which message roles changed
    const origRoles = (original.messages || []).map(m => m.role);
    const optRoles = (optimized.messages || []).map(m => m.role);
    if (JSON.stringify(origRoles) !== JSON.stringify(optRoles)) {
      lines.push(`Message structure: [${origRoles.join(', ')}] → [${optRoles.join(', ')}]`);
    }

    // Detect injected system prompt
    const origSys = this._extractSystem(original);
    const optSys = this._extractSystem(optimized);
    if (origSys !== optSys) {
      lines.push('');
      lines.push('[SYSTEM PROMPT MODIFIED]');
      if (origSys.length < optSys.length) {
        lines.push(`  Added ${optSys.length - origSys.length} chars`);
      } else {
        lines.push(`  Removed ${origSys.length - optSys.length} chars`);
      }
    }

    lines.push('─'.repeat(72));
    return lines.join('\n');
  }

  _serializeMessages(messages) {
    return messages
      .map(m => {
        const content = typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content.map(b => b.text || b.content || '').join(' ')
            : '';
        return `[${m.role}] ${content}`;
      })
      .join('\n');
  }

  _extractSystem(request) {
    if (typeof request.system === 'string') return request.system;
    const sysMsg = (request.messages || []).find(m => m.role === 'system');
    if (!sysMsg) return '';
    return typeof sysMsg.content === 'string'
      ? sysMsg.content
      : (Array.isArray(sysMsg.content)
        ? sysMsg.content.map(b => b.text || '').join('')
        : '');
  }

  _preview(text) {
    const max = this.options.maxPreviewChars;
    if (text.length <= max) return text;
    return text.slice(0, max) + `\n  ... [${text.length - max} chars truncated]`;
  }

  _emit(text) {
    if (this.options.output === 'file') {
      fs.appendFileSync(this.options.logFile, text + '\n\n');
    } else {
      process.stderr.write(text + '\n\n');
    }
  }
};
