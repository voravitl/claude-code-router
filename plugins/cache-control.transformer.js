/**
 * Cache Control Transformer (v2 — stable-prefix strategy)
 * Injects cache_control: {type: "ephemeral"} on stable content prefixes.
 * Anthropic allows up to 4 explicit breakpoints.
 * Strategy: system → first user → first assistant → second user (in priority order).
 * Skips thinking blocks, respects minimum token thresholds.
 * Converts string content to array blocks.
 * Supports multi-turn automatic caching via request-level cache_control.
 */
module.exports = class CacheControlTransformer {
  constructor(options = {}) {
    this.name = "cache-control";
    this.options = {
      enabled: true,
      providerMatch: "anthropic",
      maxBreakpoints: 4,
      minTokens: 1024,
      mode: "hybrid", // "auto" | "explicit" | "hybrid"
      ...options,
    };
  }

  async transformRequestIn(request, provider, context) {
    if (!this.options.enabled) return request;
    const providerName = (typeof provider === 'string' ? provider : provider?.name || '').toLowerCase();
    if (!providerName.includes(this.options.providerMatch)) return request;

    const messages = request.messages;
    if (!messages || !Array.isArray(messages)) return request;

    // Multi-turn automatic caching (Anthropic's top-level cache_control)
    if (this.options.mode === "auto" || this.options.mode === "hybrid") {
      request.cache_control = { type: "ephemeral" };
    }

    // For explicit mode or hybrid mode, place block-level breakpoints on stable prefixes
    if (this.options.mode === "explicit" || this.options.mode === "hybrid") {
      this._placeStableBreakpoints(messages);
    }

    return request;
  }

  _placeStableBreakpoints(messages) {
    let breakpointsPlaced = 0;
    const max = this.options.mode === "hybrid"
      ? Math.min(this.options.maxBreakpoints - 1, 3) // Reserve 1 for auto-caching
      : this.options.maxBreakpoints;

    // Priority order: system → first user → first assistant → second user
    const priorities = [];
    for (const msg of messages) {
      if (breakpointsPlaced >= max) break;

      // Wrap string content into array blocks
      if (typeof msg.content === 'string') {
        msg.content = [{ type: 'text', text: msg.content }];
      }
      if (!Array.isArray(msg.content)) continue;

      const isPriority = (
        (msg.role === 'system' && priorities.filter(p => p === 'system').length < 1) ||
        (msg.role === 'user' && priorities.filter(p => p === 'user').length < 2) ||
        (msg.role === 'assistant' && priorities.filter(p => p === 'assistant').length < 1)
      );

      if (!isPriority) continue;

      const eligible = this._findLastEligibleBlock(msg.content);
      if (eligible && this._meetsMinTokenThreshold(eligible)) {
        eligible.cache_control = { type: "ephemeral" };
        breakpointsPlaced++;
        priorities.push(msg.role);
      }
    }
  }

  _findLastEligibleBlock(content) {
    if (!Array.isArray(content) || content.length === 0) return null;
    for (let i = content.length - 1; i >= 0; i--) {
      const block = content[i];
      if (typeof block !== 'object' || block === null) continue;
      if (block.cache_control) continue;
      if (block.type === 'thinking' || block.type === 'reasoning_content') continue;
      // Skip empty text blocks
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length === 0) continue;
      return block;
    }
    return null;
  }

  _meetsMinTokenThreshold(block) {
    const text = block.text || block.content || '';
    if (typeof text !== 'string') return true; // Non-text blocks are always eligible
    const estimatedTokens = text.length / 4;
    return estimatedTokens >= this.options.minTokens;
  }

  async transformResponseOut(response, context) {
    return response;
  }
};