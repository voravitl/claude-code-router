/**
 * Tool Mode Transformer
 * Forces proxy models to use tools by setting tool_choice: "required"
 * and injecting an ExitTool function as the only way to exit tool mode.
 *
 * This prevents models like GLM, DeepSeek, devstral from forgetting
 * to use tools after long conversations.
 *
 * Config:
 *   enabled: true
 *   models: ["devstral*", "glm*", "kimi*"]  // glob patterns for matching
 *   exitToolName: "ExitTool"
 *   systemPrompt: "Tool mode is active..."
 */
module.exports = class ToolModeTransformer {
  constructor(options = {}) {
    this.name = "tool-mode";
    this.options = {
      enabled: true,
      models: ["devstral*", "glm*", "kimi*"],
      exitToolName: "ExitTool",
      systemPrompt: "Tool mode is active. The user expects you to proactively execute the most suitable tool. If no tool is appropriate, call ExitTool to exit tool mode and respond in plain text.",
      ...options,
    };
  }

  _matchesModel(modelName) {
    if (!modelName) return false;
    const lower = modelName.toLowerCase();
    return this.options.models.some(pattern => {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i');
      return regex.test(lower);
    });
  }

  async transformRequestIn(request, provider, context) {
    if (!this.options.enabled) return request;
    const model = request.model || '';
    if (!this._matchesModel(model)) return request;

    // Set tool_choice to required (string format per CCG review)
    request.tool_choice = "required";

    // Inject ExitTool function
    if (!request.tools) request.tools = [];
    const exitToolExists = request.tools.some(t => t.function?.name === this.options.exitToolName);
    if (!exitToolExists) {
      request.tools.push({
        type: "function",
        function: {
          name: this.options.exitToolName,
          description: "Exit tool mode. Call this when no tool is appropriate and you want to respond in plain text.",
          parameters: {
            type: "object",
            properties: {
              response: {
                type: "string",
                description: "Your response in plain text"
              }
            },
            required: ["response"]
          }
        }
      });
    }

    // Inject system prompt about tool mode
    if (request.messages) {
      const systemIdx = request.messages.findIndex(m => m.role === 'system');
      const toolModeNotice = `\n\n[CCR Tool Mode] ${this.options.systemPrompt}`;
      if (systemIdx >= 0) {
        const content = request.messages[systemIdx].content;
        if (typeof content === 'string') {
          request.messages[systemIdx].content = content + toolModeNotice;
        } else if (Array.isArray(content)) {
          // Append to last text element, or add new text element
          const lastText = content.filter(c => c.type === 'text').pop();
          if (lastText) {
            lastText.text += toolModeNotice;
          } else {
            content.push({ type: 'text', text: `[CCR Tool Mode] ${this.options.systemPrompt}` });
          }
        }
      } else {
        request.messages.unshift({
          role: 'system',
          content: `[CCR Tool Mode] ${this.options.systemPrompt}`
        });
      }
    }

    return request;
  }

  async transformResponseOut(response, context) {
    if (!this.options.enabled) return response;
    if (!response || !response.choices) return response;

    for (const choice of response.choices) {
      if (!choice.message) continue;

      // Check if model called ExitTool
      const toolCalls = choice.message.tool_calls;
      if (!toolCalls || toolCalls.length === 0) continue;

      const exitCall = toolCalls.find(tc => tc.function?.name === this.options.exitToolName);
      if (!exitCall) continue;

      // Reject mixed ExitTool + real tool calls — don't normalize
      const otherCalls = toolCalls.filter(tc => tc.function?.name !== this.options.exitToolName);
      if (otherCalls.length > 0) continue;

      // Extract response from ExitTool call
      try {
        const args = typeof exitCall.function.arguments === 'string'
          ? JSON.parse(exitCall.function.arguments)
          : exitCall.function.arguments;
        const responseText = args?.response || '';

        // Remove tool_calls and set content
        choice.message.content = responseText;
        choice.message.tool_calls = choice.message.tool_calls.filter(tc => tc.function?.name !== this.options.exitToolName);

        // If no tool calls remain, remove tool_calls entirely
        if (choice.message.tool_calls.length === 0) {
          delete choice.message.tool_calls;
          // Also remove forced tool_choice from request context if possible
          if (choice.finish_reason === 'tool_calls' && !choice.message.tool_calls) {
            choice.finish_reason = 'stop';
          }
        }
      } catch (e) {
        // If parsing fails, leave response as-is
      }
    }
    return response;
  }
};
