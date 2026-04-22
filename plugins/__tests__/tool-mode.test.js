const { describe, it } = require('node:test');
const assert = require('node:assert');
const ToolModeTransformer = require('../tool-mode.transformer.js');

describe('ToolModeTransformer', () => {
  describe('constructor', () => {
    it('defaults options correctly', () => {
      const t = new ToolModeTransformer();
      assert.strictEqual(t.options.enabled, true);
      assert.deepStrictEqual(t.options.models, ['devstral*', 'glm*', 'kimi*']);
      assert.strictEqual(t.options.exitToolName, 'ExitTool');
      assert.ok(t.options.systemPrompt.includes('Tool mode is active'));
    });

    it('accepts custom options', () => {
      const t = new ToolModeTransformer({ enabled: false, exitToolName: 'Quit' });
      assert.strictEqual(t.options.enabled, false);
      assert.strictEqual(t.options.exitToolName, 'Quit');
    });
  });

  describe('_matchesModel', () => {
    it('matches devstral patterns', () => {
      const t = new ToolModeTransformer();
      assert.strictEqual(t._matchesModel('devstral-2'), true);
      assert.strictEqual(t._matchesModel('DEVSTRAL-2'), true);
      assert.strictEqual(t._matchesModel('glm-5.1'), true);
      assert.strictEqual(t._matchesModel('kimi-k2.6'), true);
    });

    it('does not match unrelated models', () => {
      const t = new ToolModeTransformer();
      assert.strictEqual(t._matchesModel('gpt-4'), false);
      assert.strictEqual(t._matchesModel('claude-sonnet'), false);
      assert.strictEqual(t._matchesModel(''), false);
      assert.strictEqual(t._matchesModel(null), false);
    });

    it('matches custom patterns', () => {
      const t = new ToolModeTransformer({ models: ['qwen*'] });
      assert.strictEqual(t._matchesModel('qwen3.5'), true);
      assert.strictEqual(t._matchesModel('glm-5.1'), false);
    });
  });

  describe('transformRequestIn', () => {
    it('passthrough when disabled', async () => {
      const t = new ToolModeTransformer({ enabled: false });
      const req = { model: 'devstral-2', messages: [{ role: 'user', content: 'hi' }] };
      const result = await t.transformRequestIn(req, null, {});
      assert.strictEqual(result, req);
    });

    it('passthrough for non-matching model', async () => {
      const t = new ToolModeTransformer();
      const req = { model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] };
      const result = await t.transformRequestIn(req, null, {});
      assert.deepStrictEqual(result, req);
    });

    it('sets tool_choice to required for matching model', async () => {
      const t = new ToolModeTransformer();
      const req = { model: 'devstral-2', messages: [{ role: 'user', content: 'hi' }] };
      const result = await t.transformRequestIn(req, null, {});
      assert.strictEqual(result.tool_choice, 'required');
    });

    it('injects ExitTool function', async () => {
      const t = new ToolModeTransformer();
      const req = { model: 'devstral-2', messages: [{ role: 'user', content: 'hi' }] };
      const result = await t.transformRequestIn(req, null, {});
      assert.ok(Array.isArray(result.tools));
      const exitTool = result.tools.find(tool => tool.function?.name === 'ExitTool');
      assert.ok(exitTool, 'ExitTool should be injected');
      assert.strictEqual(exitTool.type, 'function');
      assert.ok(exitTool.function.description.includes('Exit tool mode'));
    });

    it('does not duplicate ExitTool if already present', async () => {
      const t = new ToolModeTransformer();
      const existingTool = {
        type: 'function',
        function: { name: 'ExitTool', description: 'existing' }
      };
      const req = { model: 'devstral-2', messages: [{ role: 'user', content: 'hi' }], tools: [existingTool] };
      const result = await t.transformRequestIn(req, null, {});
      const exitTools = result.tools.filter(tool => tool.function?.name === 'ExitTool');
      assert.strictEqual(exitTools.length, 1);
    });

    it('injects system prompt when no system message exists', async () => {
      const t = new ToolModeTransformer();
      const req = { model: 'devstral-2', messages: [{ role: 'user', content: 'hi' }] };
      const result = await t.transformRequestIn(req, null, {});
      const systemMsg = result.messages.find(m => m.role === 'system');
      assert.ok(systemMsg);
      assert.ok(systemMsg.content.includes('[CCR Tool Mode]'));
      assert.ok(systemMsg.content.includes('Tool mode is active'));
    });

    it('appends to existing system message', async () => {
      const t = new ToolModeTransformer();
      const req = { model: 'devstral-2', messages: [{ role: 'system', content: 'Be helpful' }, { role: 'user', content: 'hi' }] };
      const result = await t.transformRequestIn(req, null, {});
      const systemMsg = result.messages.find(m => m.role === 'system');
      assert.ok(systemMsg.content.startsWith('Be helpful'));
      assert.ok(systemMsg.content.includes('[CCR Tool Mode]'));
    });

    it('appends to existing system message as array', async () => {
      const t = new ToolModeTransformer();
      const req = {
        model: 'devstral-2',
        messages: [{ role: 'system', content: [{ type: 'text', text: 'Be helpful' }] }, { role: 'user', content: 'hi' }]
      };
      const result = await t.transformRequestIn(req, null, {});
      const systemMsg = result.messages.find(m => m.role === 'system');
      assert.ok(Array.isArray(systemMsg.content));
      assert.strictEqual(systemMsg.content[0].type, 'text');
      assert.ok(systemMsg.content[0].text.startsWith('Be helpful'));
      assert.ok(systemMsg.content[0].text.includes('[CCR Tool Mode]'));
    });

    it('adds text element to system array with no text entries', async () => {
      const t = new ToolModeTransformer();
      const req = {
        model: 'devstral-2',
        messages: [{ role: 'system', content: [{ type: 'image_url', image_url: 'url' }] }, { role: 'user', content: 'hi' }]
      };
      const result = await t.transformRequestIn(req, null, {});
      const systemMsg = result.messages.find(m => m.role === 'system');
      assert.strictEqual(systemMsg.content.length, 2);
      assert.strictEqual(systemMsg.content[1].type, 'text');
      assert.ok(systemMsg.content[1].text.includes('[CCR Tool Mode]'));
    });
  });

  describe('transformResponseOut', () => {
    it('passthrough when disabled', async () => {
      const t = new ToolModeTransformer({ enabled: false });
      const res = { choices: [{ message: { content: 'hello' } }] };
      const result = await t.transformResponseOut(res, {});
      assert.strictEqual(result, res);
    });

    it('passthrough for null response', async () => {
      const t = new ToolModeTransformer();
      const result = await t.transformResponseOut(null, {});
      assert.strictEqual(result, null);
    });

    it('extracts ExitTool response and removes tool_calls', async () => {
      const t = new ToolModeTransformer();
      const res = {
        choices: [{
          message: {
            content: '',
            tool_calls: [{
              function: {
                name: 'ExitTool',
                arguments: JSON.stringify({ response: 'Plain text answer' })
              }
            }]
          },
          finish_reason: 'tool_calls'
        }]
      };
      const result = await t.transformResponseOut(res, {});
      const msg = result.choices[0].message;
      assert.strictEqual(msg.content, 'Plain text answer');
      assert.strictEqual(msg.tool_calls, undefined);
      assert.strictEqual(result.choices[0].finish_reason, 'stop');
    });

    it('handles ExitTool with object arguments', async () => {
      const t = new ToolModeTransformer();
      const res = {
        choices: [{
          message: {
            content: '',
            tool_calls: [{
              function: {
                name: 'ExitTool',
                arguments: { response: 'Object args' }
              }
            }]
          },
          finish_reason: 'tool_calls'
        }]
      };
      const result = await t.transformResponseOut(res, {});
      assert.strictEqual(result.choices[0].message.content, 'Object args');
    });

    it('rejects mixed ExitTool + real tool_calls (passthrough)', async () => {
      const t = new ToolModeTransformer();
      const res = {
        choices: [{
          message: {
            content: '',
            tool_calls: [
              { function: { name: 'SearchTool', arguments: '{}' } },
              { function: { name: 'ExitTool', arguments: JSON.stringify({ response: 'Done' }) } }
            ]
          },
          finish_reason: 'tool_calls'
        }]
      };
      const result = await t.transformResponseOut(res, {});
      const msg = result.choices[0].message;
      assert.strictEqual(msg.content, '');
      assert.strictEqual(msg.tool_calls.length, 2);
    });

    it('leaves normal tool response unchanged', async () => {
      const t = new ToolModeTransformer();
      const res = {
        choices: [{
          message: {
            content: '',
            tool_calls: [{ function: { name: 'SearchTool', arguments: '{}' } }]
          },
          finish_reason: 'tool_calls'
        }]
      };
      const result = await t.transformResponseOut(res, {});
      const msg = result.choices[0].message;
      assert.strictEqual(msg.content, '');
      assert.strictEqual(msg.tool_calls.length, 1);
      assert.strictEqual(msg.tool_calls[0].function.name, 'SearchTool');
    });

    it('handles invalid ExitTool arguments gracefully', async () => {
      const t = new ToolModeTransformer();
      const res = {
        choices: [{
          message: {
            content: 'original',
            tool_calls: [{ function: { name: 'ExitTool', arguments: 'not-json' } }]
          },
          finish_reason: 'tool_calls'
        }]
      };
      const result = await t.transformResponseOut(res, {});
      const msg = result.choices[0].message;
      assert.strictEqual(msg.content, 'original');
      assert.strictEqual(msg.tool_calls.length, 1);
    });

    it('handles missing response in ExitTool args', async () => {
      const t = new ToolModeTransformer();
      const res = {
        choices: [{
          message: {
            content: 'original',
            tool_calls: [{ function: { name: 'ExitTool', arguments: JSON.stringify({}) } }]
          },
          finish_reason: 'tool_calls'
        }]
      };
      const result = await t.transformResponseOut(res, {});
      assert.strictEqual(result.choices[0].message.content, '');
    });
  });
});
