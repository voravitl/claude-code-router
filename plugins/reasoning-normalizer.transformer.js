/**
 * Reasoning Normalizer Transformer
 * Normalizes reasoning output format across providers.
 * Converts between: <thinking> tags, reasoning field, <reasoning_content> tags, reasoning_content field.
 *
 * NOTE: This transformer is a FALLBACK. Upstream already handles reasoning translation via
 *   reasoning.transformer.ts, deepseek.transformer.ts, and forcereasoning.transformer.ts.
 *   Only activate this for providers NOT covered by upstream transformers.
 *
 * Config:
 *   enabled: true
 *   outputFormat: "thinking"  // target format: "thinking" | "reasoning" | "reasoning_content" | "none"
 *   providerFormats: {        // per-provider input format mapping
 *     "ollama": "reasoning_content",
 *     "gemini-oauth": "thinking",
 *     "anthropic": "thinking"
 *   }
 */
module.exports = class ReasoningNormalizerTransformer {
  constructor(options = {}) {
    this.name = "reasoning-normalizer";
    this.options = {
      enabled: false,
      outputFormat: "thinking",
      providerFormats: {},
      ...options,
    };
  }

  _detectInputFormat(response, providerName) {
    if (this.options.providerFormats[providerName]) {
      return this.options.providerFormats[providerName];
    }
    const choice = response?.choices?.[0]?.message;
    if (!choice) return null;

    if (choice.reasoning_content) return "reasoning_content";
    if (choice.reasoning) return "reasoning";
    if (typeof choice.content === "string") {
      if (choice.content.includes("<thinking>")) return "thinking";
      if (choice.content.includes("⌀")) return "think_tag";
      if (choice.content.includes("<reasoning_content>")) return "reasoning_content";
    }
    return null;
  }

  _extractReasoning(choice, inputFormat) {
    switch (inputFormat) {
      case "think_tag": {
        // DeepSeek R1 uses ⌀...⌀ to delimit thinking
        const match = (choice.content || "").match(/⌀([\s\S]*?)⌀/);
        return match
          ? {
              reasoning: match[1].trim(),
              remainingContent: (choice.content || "").replace(/⌀[\s\S]*?⌀/, "").trim(),
            }
          : null;
      }
      case "thinking": {
        const match = (choice.content || "").match(/<thinking>([\s\S]*?)<\/thinking>/);
        return match
          ? {
              reasoning: match[1].trim(),
              remainingContent: (choice.content || "").replace(/<thinking>[\s\S]*?<\/thinking>/, "").trim(),
            }
          : null;
      }
      case "reasoning":
        return { reasoning: choice.reasoning || "", remainingContent: choice.content || "" };
      case "reasoning_content": {
        if (choice.reasoning_content) {
          return { reasoning: choice.reasoning_content, remainingContent: choice.content || "" };
        }
        const rcMatch = (choice.content || "").match(/<reasoning_content>([\s\S]*?)<\/reasoning_content>/);
        return rcMatch
          ? {
              reasoning: rcMatch[1].trim(),
              remainingContent: (choice.content || "").replace(/<reasoning_content>[\s\S]*?<\/reasoning_content>/, "").trim(),
            }
          : null;
      }
      default:
        return null;
    }
  }

  _convertToTarget(reasoning, remainingContent, targetFormat) {
    const choice = {};
    switch (targetFormat) {
      case "thinking":
        choice.content = reasoning
          ? `<thinking>\n${reasoning}\n</thinking>\n${remainingContent}`
          : remainingContent;
        break;
      case "reasoning":
        choice.content = remainingContent;
        choice.reasoning = reasoning;
        break;
      case "reasoning_content":
        choice.content = remainingContent;
        choice.reasoning_content = reasoning;
        break;
      case "none":
        choice.content = remainingContent;
        break;
    }
    return choice;
  }

  async transformResponseOut(response, context) {
    if (!this.options.enabled) return response;
    if (!response || !response.choices) return response;

    const providerName = context?.provider?.name || context?.provider || "";

    for (const choice of response.choices) {
      if (!choice.message) continue;
      const inputFormat = this._detectInputFormat(response, providerName);
      if (!inputFormat) continue;

      const extracted = this._extractReasoning(choice.message, inputFormat);
      if (!extracted) continue;

      const converted = this._convertToTarget(
        extracted.reasoning,
        extracted.remainingContent,
        this.options.outputFormat
      );
      Object.assign(choice.message, converted);
      if (this.options.outputFormat !== "reasoning") delete choice.message.reasoning;
      if (this.options.outputFormat !== "reasoning_content") delete choice.message.reasoning_content;
    }
    return response;
  }

  async transformRequestIn(request, provider, context) {
    return request;
  }
};
