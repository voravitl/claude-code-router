const { describe, it } = require('node:test');
const assert = require('node:assert');
const ProgressiveToolDisclosureTransformer = require('../progressive-tool-disclosure.transformer.js');

function makeTransformer(options = {}) {
  return new ProgressiveToolDisclosureTransformer(options);
}

function makeTool(name, description, parameters) {
  return {
    type: 'function',
    function: { name, description, parameters: parameters || { type: 'object', properties: {} } }
  };
}

describe('ProgressiveToolDisclosureTransformer', () => {
  describe('constructor', () => {
    it('creates instance with default options', () => {
      const t = makeTransformer();
      assert.strictEqual(t.name, 'progressive-tool-disclosure');
      assert.strictEqual(t.options.enabled, true);
      assert.strictEqual(t.options.strategy, 'auto');
      assert.strictEqual(t.options.threshold, 30);
    });

    it('allows custom options', () => {
      const t = makeTransformer({ threshold: 10, strategy: 'skeleton' });
      assert.strictEqual(t.options.threshold, 10);
      assert.strictEqual(t.options.strategy, 'skeleton');
    });
  });

  describe('transformRequestIn', () => {
    it('returns passthrough when disabled', async () => {
      const t = makeTransformer({ enabled: false });
      const request = { tools: [makeTool('a', 'desc')] };
      const result = await t.transformRequestIn(request);
      assert.deepStrictEqual(result, request);
    });

    it('returns passthrough when no tools', async () => {
      const t = makeTransformer();
      const request = { messages: [] };
      const result = await t.transformRequestIn(request);
      assert.deepStrictEqual(result, request);
    });

    it('returns passthrough when tools empty', async () => {
      const t = makeTransformer();
      const request = { tools: [] };
      const result = await t.transformRequestIn(request);
      assert.deepStrictEqual(result, request);
    });

    it('returns passthrough when under threshold with auto strategy', async () => {
      const t = makeTransformer({ threshold: 5 });
      const request = {
        tools: [
          makeTool('tool1', 'First tool description'),
          makeTool('tool2', 'Second tool description'),
        ],
        messages: []
      };
      const result = await t.transformRequestIn(request);
      assert.deepStrictEqual(result, request);
    });

    it('activates skeleton mode when over threshold with auto strategy', async () => {
      const t = makeTransformer({ threshold: 2 });
      const tools = [
        makeTool('tool1', 'First tool description\nwith multiple lines'),
        makeTool('tool2', 'Second tool description'),
        makeTool('tool3', 'Third tool description that is quite long and should be truncated'),
      ];
      const request = {
        tools,
        messages: []
      };
      const result = await t.transformRequestIn(request);

      assert.strictEqual(result.tools.length, 4); // 3 skeleton + ToolDetails
      // Descriptions are truncated to first line, max 120 chars
      assert.ok(result.tools[0].function.description.length <= 120);
      assert.ok(!result.tools[0].function.description.includes('\n'));
    });

    it('always activates skeleton mode with skeleton strategy', async () => {
      const t = makeTransformer({ strategy: 'skeleton' });
      const request = {
        tools: [makeTool('tool1', 'A long description that spans multiple lines\nand has details')],
        messages: []
      };
      const result = await t.transformRequestIn(request);
      // Description should be first line only, truncated to 120 chars
      assert.ok(!result.tools[0].function.description.includes('\n'));
      const toolDetails = result.tools.find(t => t.function.name === 'ToolDetails');
      assert.ok(toolDetails);
    });

    it('returns passthrough with full strategy', async () => {
      const t = makeTransformer({ strategy: 'full' });
      const request = {
        tools: [makeTool('tool1', 'Desc')],
        messages: []
      };
      const result = await t.transformRequestIn(request);
      assert.deepStrictEqual(result, request);
    });

    it('adds ToolDetails tool when in skeleton mode', async () => {
      const t = makeTransformer({ strategy: 'skeleton' });
      const request = {
        tools: [makeTool('tool1', 'Desc')],
        messages: []
      };
      const result = await t.transformRequestIn(request);
      const toolDetails = result.tools.find(t => t.function.name === 'ToolDetails');
      assert.ok(toolDetails);
      assert.strictEqual(toolDetails.function.parameters.type, 'object');
      assert.ok(toolDetails.function.parameters.properties.toolNames);
      assert.deepStrictEqual(toolDetails.function.parameters.required, ['toolNames']);
    });

    it('injects system reminder message when in skeleton mode', async () => {
      const t = makeTransformer({ strategy: 'skeleton' });
      const request = {
        tools: [makeTool('tool1', 'Desc')],
        messages: [{ role: 'user', content: 'hello' }]
      };
      const result = await t.transformRequestIn(request);
      const systemMsg = result.messages.find(m => m.role === 'system');
      assert.ok(systemMsg);
      assert.ok(systemMsg.content.includes('Progressive Tool Disclosure is active'));
      assert.ok(systemMsg.content.includes('tool1'));
    });

    it('preserves original tools in _fullTools metadata', async () => {
      const t = makeTransformer({ strategy: 'skeleton' });
      const originalTools = [makeTool('tool1', 'Full description here')];
      const request = {
        tools: [...originalTools],
        messages: []
      };
      const result = await t.transformRequestIn(request);
      assert.strictEqual(result._fullTools.length, 1);
      assert.strictEqual(result._fullTools[0].function.name, 'tool1');
      assert.strictEqual(result._fullTools[0].function.description, 'Full description here');
    });

    it('truncates long descriptions to first line, max 120 chars', async () => {
      const t = makeTransformer({ strategy: 'skeleton' });
      const longDesc = 'A'.repeat(200);
      const request = {
        tools: [makeTool('tool1', longDesc)],
        messages: []
      };
      const result = await t.transformRequestIn(request);
      const desc = result.tools[0].function.description;
      assert.strictEqual(desc.length, 120);
      assert.ok(!desc.includes('\n'));
    });

    it('preserves tool name and type in skeleton mode', async () => {
      const t = makeTransformer({ strategy: 'skeleton' });
      const request = {
        tools: [makeTool('my_tool', 'Does something useful')],
        messages: []
      };
      const result = await t.transformRequestIn(request);
      assert.strictEqual(result.tools[0].type, 'function');
      assert.strictEqual(result.tools[0].function.name, 'my_tool');
    });

    it('strips parameter descriptions but keeps names, types, and enums', async () => {
      const t = makeTransformer({ strategy: 'skeleton' });
      const request = {
        tools: [makeTool('tool1', 'Desc', {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', description: 'The file path to read' },
            mode: { type: 'string', enum: ['read', 'write'], description: 'A very long description that exceeds sixty characters limit here' },
          }
        })],
        messages: []
      };
      const result = await t.transformRequestIn(request);
      const params = result.tools[0].function.parameters;
      assert.deepStrictEqual(params.required, ['path']);
      assert.ok(params.properties.path);
      assert.strictEqual(params.properties.path.type, 'string');
      // Short descriptions (<=60 chars) are kept
      assert.strictEqual(params.properties.path.description, 'The file path to read');
      assert.strictEqual(params.properties.mode.type, 'string');
      assert.deepStrictEqual(params.properties.mode.enum, ['read', 'write']);
      // Long descriptions (>60 chars) are stripped
      assert.strictEqual(params.properties.mode.description, undefined);
    });

    it('transformResponseOut returns response unchanged', async () => {
      const t = makeTransformer();
      const response = { foo: 'bar' };
      const result = await t.transformResponseOut(response);
      assert.strictEqual(result, response);
    });
  });
});