/**
 * Progressive Tool Disclosure Transformer (v2 — Skeleton Mode)
 *
 * Instead of erasing tool descriptions entirely, this keeps parameter names/types
 * but strips long descriptions when tool count exceeds threshold.
 * This saves ~70% tokens while preserving enough structure for models to
 * attempt calls without the "page fault" problem of calling ToolDetails first.
 *
 * Threshold raised to 30 (from 5) — models need full descriptions to choose correctly.
 * Only strips descriptions when tool count is very high.
 */
module.exports = class ProgressiveToolDisclosureTransformer {
  constructor(options = {}) {
    this.name = "progressive-tool-disclosure";
    this.options = {
      enabled: true,
      strategy: "auto", // "auto", "skeleton", "full"
      threshold: 30,     // Only activate when tool count exceeds this
      ...options,
    };
  }

  async transformRequestIn(request) {
    if (!this.options.enabled || !request.tools || request.tools.length === 0) {
      return request;
    }

    const toolCount = request.tools.length;
    const useSkeleton = this.options.strategy === "skeleton" ||
      (this.options.strategy === "auto" && toolCount > this.options.threshold);

    if (!useSkeleton) return request;

    // Save full tool definitions in request metadata (internal use)
    request._fullTools = [...request.tools];

    // Skeleton mode: keep param names/types/enums, strip descriptions
    request.tools = request.tools.map(t => ({
      ...t,
      function: {
        ...t.function,
        description: t.function.description
          ? t.function.description.split('\n')[0].substring(0, 120)
          : undefined,
        parameters: this._stripParamDescriptions(t.function.parameters),
      },
    }));

    // Only add ToolDetails if we actually collapsed tools
    request.tools.push({
      type: "function",
      function: {
        name: "ToolDetails",
        description: "Request the full JSON schema and detailed documentation for one or more tools. Call this ONLY when you need detailed parameter descriptions that were stripped.",
        parameters: {
          type: "object",
          properties: {
            toolNames: {
              type: "array",
              items: { type: "string" },
              description: "List of tool names to retrieve details for.",
            },
          },
          required: ["toolNames"],
        },
      },
    });

    // Inject system reminder with tool overview
    const toolOverviews = request._fullTools
      .map(t => `- ${t.function.name}: ${t.function.description?.split('\n')[0].substring(0, 80) || 'No description'}`)
      .join('\n');

    request.messages.push({
      role: "system",
      content: `<system-reminder>
Progressive Tool Disclosure is active. Tool descriptions have been shortened to save context space.
Parameter names and types are preserved. For full documentation, call ToolDetails({ toolNames: ["tool_name"] }).
Available tools:
${toolOverviews}
</system-reminder>`,
    });

    return request;
  }

  /**
   * Strip descriptions from parameter schemas, keeping names/types/enums/required.
   * This preserves enough structure for models to attempt calls.
   */
  _stripParamDescriptions(schema) {
    if (!schema || typeof schema !== 'object') return schema;
    const result = { type: schema.type };

    // Keep required array if present
    if (Array.isArray(schema.required)) {
      result.required = schema.required;
    }

    // Keep property names, types, and enums — strip descriptions and examples
    if (schema.properties && typeof schema.properties === 'object') {
      result.properties = Object.fromEntries(
        Object.entries(schema.properties).map(([key, val]) => {
          if (typeof val !== 'object' || val === null) return [key, val];
          const stripped = { type: val.type };
          if (Array.isArray(val.enum)) stripped.enum = val.enum;
          if (val.items) stripped.items = this._stripParamDescriptions(val.items);
          // Keep short one-line descriptions (under 60 chars)
          if (typeof val.description === 'string' && val.description.length <= 60) {
            stripped.description = val.description;
          }
          return [key, stripped];
        }),
      );
    }

    return result;
  }

  async transformResponseOut(response, context) {
    return response;
  }
};