const { describe, it } = require('node:test');
const assert = require('node:assert');
const SmartOptimizerTransformer = require('../smart-optimizer.transformer.js');

function makeOptimizer() {
  return new SmartOptimizerTransformer({ enableLLMOptimization: false });
}

describe('SmartOptimizerTransformer', () => {
  describe('constructor', () => {
    it('creates instance with default options', () => {
      const opt = makeOptimizer();
      assert.strictEqual(opt.name, 'smart-optimizer');
      assert.strictEqual(opt.options.enableLLMOptimization, false);
    });

    it('has tokenStats initialized', () => {
      const opt = makeOptimizer();
      assert.strictEqual(opt.tokenStats.totalRequests, 0);
      assert.strictEqual(opt.tokenStats.totalTokens, 0);
    });
  });

  describe('transformRequestIn', () => {
    it('returns passthrough for no messages', async () => {
      const opt = makeOptimizer();
      const request = { model: 'test' };
      const result = await opt.transformRequestIn(request, {}, {});
      assert.deepStrictEqual(result, request);
    });

    it('preserves reasoning_effort if already set to "high"', async () => {
      const opt = makeOptimizer();
      const request = { model: 'test', reasoning_effort: 'high', messages: [{ role: 'user', content: 'hello' }] };
      const result = await opt.transformRequestIn(request, {}, {});
      assert.strictEqual(result.reasoning_effort, 'high');
    });

    it('sets reasoning_effort to "none" when undefined', async () => {
      const opt = makeOptimizer();
      const request = { model: 'test', messages: [{ role: 'user', content: 'hello' }] };
      const result = await opt.transformRequestIn(request, {}, {});
      assert.strictEqual(result.reasoning_effort, 'none');
    });

    it('applies effortOverride for known model', async () => {
      const opt = new SmartOptimizerTransformer({
        enableLLMOptimization: false,
        effortOverride: { 'glm-5.1': 'none' },
      });
      const request = { model: 'glm-5.1:cloud', messages: [{ role: 'user', content: 'hello' }] };
      const result = await opt.transformRequestIn(request, {}, {});
      assert.strictEqual(result.reasoning_effort, 'none');
    });
  });

  describe('analyzeContent', () => {
    it('returns general for empty string', () => {
      const opt = makeOptimizer();
      const result = opt.analyzeContent('');
      assert.strictEqual(result.type, 'general');
    });

    it('returns general for non-string', () => {
      const opt = makeOptimizer();
      const result = opt.analyzeContent(null);
      assert.strictEqual(result.type, 'general');
    });

    it('classifies "debug this bug" as debugging', () => {
      const opt = makeOptimizer();
      const result = opt.analyzeContent('debug this bug');
      assert.strictEqual(result.type, 'debugging');
    });

    it('classifies "implement feature" as codeGeneration', () => {
      const opt = makeOptimizer();
      const result = opt.analyzeContent('implement feature');
      assert.strictEqual(result.type, 'codeGeneration');
    });

    it('classifies "review this code" as codeReview', () => {
      const opt = makeOptimizer();
      const result = opt.analyzeContent('review this code');
      assert.strictEqual(result.type, 'codeReview');
    });
  });

  describe('removeFillers', () => {
    it('removes Thai filler "กรุณา"', () => {
      const opt = makeOptimizer();
      const result = opt.removeFillers('กรุณาเขียนโค้ด');
      assert.strictEqual(result, 'เขียนโค้ด');
    });

    it('removes English filler "please "', () => {
      const opt = makeOptimizer();
      const result = opt.removeFillers('please write code');
      assert.strictEqual(result, 'write code');
    });

    it('preserves non-filler text', () => {
      const opt = makeOptimizer();
      const result = opt.removeFillers('sort the array');
      assert.strictEqual(result, 'sort the array');
    });

    it('handles non-string input', () => {
      const opt = makeOptimizer();
      const result = opt.removeFillers(42);
      assert.strictEqual(result, 42);
    });
  });

  describe('scanForImages', () => {
    it('detects image type="image" with source', () => {
      const opt = makeOptimizer();
      const messages = [{ role: 'user', content: [
        { type: 'text', text: 'describe' },
        { type: 'image', source: { type: 'base64', data: 'abc' } },
      ]}];
      assert.strictEqual(opt.scanForImages(messages), true);
    });

    it('detects image type="image_url"', () => {
      const opt = makeOptimizer();
      const messages = [{ role: 'user', content: [
        { type: 'text', text: 'analyze' },
        { type: 'image_url', image_url: { url: 'https://x.com/img.png' } },
      ]}];
      assert.strictEqual(opt.scanForImages(messages), true);
    });

    it('returns false for text-only messages', () => {
      const opt = makeOptimizer();
      const messages = [{ role: 'user', content: 'just text' }];
      assert.strictEqual(opt.scanForImages(messages), false);
    });

    it('returns false for non-array input', () => {
      const opt = makeOptimizer();
      assert.strictEqual(opt.scanForImages(null), false);
      assert.strictEqual(opt.scanForImages('string'), false);
    });
  });

  describe('structurePrompt', () => {
    it('places ccr-role before thinking in output', () => {
      const opt = makeOptimizer();
      const result = opt.structurePrompt('write a function', 'codeGeneration');
      const ccrRolePos = result.indexOf('<ccr-role>');
      const thinkingPos = result.indexOf('<thinking>');
      assert.ok(ccrRolePos >= 0, 'should contain <ccr-role>');
      assert.ok(thinkingPos >= 0, 'should contain <thinking>');
      assert.ok(ccrRolePos < thinkingPos, '<ccr-role> should come before <thinking>');
    });

    it('wraps content in ccr-task tags', () => {
      const opt = makeOptimizer();
      const result = opt.structurePrompt('my task', 'codeGeneration');
      assert.ok(result.includes('<ccr-task>'));
      assert.ok(result.includes('my task'));
      assert.ok(result.includes('</ccr-task>'));
    });

    it('includes COT only for COT-eligible types', () => {
      const opt = makeOptimizer();
      const withCot = opt.structurePrompt('test', 'debugging');
      assert.ok(withCot.includes('<thinking>'), 'debugging should have COT');

      const withoutCot = opt.structurePrompt('test', 'explanation');
      assert.ok(!withoutCot.includes('<thinking>'), 'explanation should not have COT');
    });
  });

  describe('tokenStats', () => {
    it('accumulates after transformRequestIn calls', async () => {
      const opt = makeOptimizer();
      const request = { model: 'test', messages: [{ role: 'user', content: 'hello world testing' }] };
      await opt.transformRequestIn(request, {}, {});
      assert.strictEqual(opt.tokenStats.totalRequests, 1);
      assert.ok(opt.tokenStats.totalTokens > 0);
    });

    it('getTokenStats returns computed fields', async () => {
      const opt = makeOptimizer();
      const request = { model: 'test', messages: [{ role: 'user', content: 'hello' }] };
      await opt.transformRequestIn(request, {}, {});
      const stats = opt.getTokenStats();
      assert.ok(typeof stats.averageTokensPerRequest === 'number');
      assert.ok(typeof stats.compressionSavings === 'string');
    });
  });

  describe('estimateTokens', () => {
    it('returns 0 for empty string', () => {
      const opt = makeOptimizer();
      assert.strictEqual(opt.estimateTokens(''), 0);
    });

    it('returns positive number for text', () => {
      const opt = makeOptimizer();
      assert.ok(opt.estimateTokens('Hello world') > 0);
    });

    it('caches repeated calls', () => {
      const opt = makeOptimizer();
      const first = opt.estimateTokens('cached text');
      const second = opt.estimateTokens('cached text');
      assert.strictEqual(first, second);
    });
  });

  describe('extractContent', () => {
    it('extracts string content', () => {
      const opt = makeOptimizer();
      assert.strictEqual(opt.extractContent({ content: 'hello' }), 'hello');
    });

    it('extracts text from content array', () => {
      const opt = makeOptimizer();
      const msg = { content: [{ type: 'text', text: 'hello' }, { type: 'image', source: {} }] };
      assert.strictEqual(opt.extractContent(msg), 'hello');
    });

    it('returns empty string for null message', () => {
      const opt = makeOptimizer();
      assert.strictEqual(opt.extractContent(null), '');
    });
  });

  describe('_sanitizeToolPairs', () => {
    it('inserts stub for forward orphan (tool_call without result)', () => {
      const opt = makeOptimizer();
      const messages = [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'ok', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'x', arguments: '{}' } }] },
      ];
      const result = opt._sanitizeToolPairs(messages);
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[2].role, 'tool');
      assert.strictEqual(result[2].tool_call_id, 'call_1');
      assert.ok(result[2].content.includes('Result from earlier conversation'));
    });

    it('removes backward orphan (tool_result without call)', () => {
      const opt = makeOptimizer();
      const messages = [
        { role: 'user', content: 'hello' },
        { role: 'tool', tool_call_id: 'orphan_1', content: 'result' },
      ];
      const result = opt._sanitizeToolPairs(messages);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].role, 'user');
    });

    it('handles both forward and backward orphans', () => {
      const opt = makeOptimizer();
      const messages = [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'ok', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'x', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'orphan_1', content: 'no matching call' },
      ];
      const result = opt._sanitizeToolPairs(messages);
      // Backward orphan removed (orphan_1)
      // Forward orphan stub inserted for call_1
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0].role, 'user');
      assert.strictEqual(result[1].role, 'assistant');
      assert.strictEqual(result[2].role, 'tool');
      assert.strictEqual(result[2].tool_call_id, 'call_1');
    });

    it('passes through clean conversation (no orphans)', () => {
      const opt = makeOptimizer();
      const messages = [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'ok', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'x', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: 'result' },
      ];
      const result = opt._sanitizeToolPairs(messages);
      assert.deepStrictEqual(result, messages);
    });

    it('passes through empty messages array', () => {
      const opt = makeOptimizer();
      const result = opt._sanitizeToolPairs([]);
      assert.deepStrictEqual(result, []);
    });
  });

  describe('_pruneToolOutputs', () => {
    it('prunes old terminal output to 1-line summary', () => {
      const opt = new SmartOptimizerTransformer({ toolPruningMaxAge: 1 });
      const terminalOutput = 'line1\nline2\nline3\nexit 1\n' + 'x'.repeat(300);
      const messages = [
        { role: 'assistant', tool_calls: [{ id: 't1', function: { name: 'terminal' } }] },
        { role: 'tool', tool_call_id: 't1', content: terminalOutput },
        { role: 'user', content: 'next' },
        { role: 'assistant', content: 'thinking' },
      ];
      const result = opt._pruneToolOutputs(messages);
      assert.strictEqual(result[1].role, 'tool');
      assert.ok(result[1].content.includes('[terminal] exit 1'));
      assert.ok(result[1]._pruned);
    });

    it('summarizes old read_file result', () => {
      const opt = new SmartOptimizerTransformer({ toolPruningMaxAge: 1 });
      const fileContent = 'a\nb\nc\n' + 'x'.repeat(300);
      const messages = [
        { role: 'assistant', tool_calls: [{ id: 'f1', function: { name: 'read_file' } }] },
        { role: 'tool', tool_call_id: 'f1', content: fileContent },
        { role: 'user', content: 'next' },
        { role: 'assistant', content: 'thinking' },
      ];
      const result = opt._pruneToolOutputs(messages);
      assert.ok(result[1].content.includes('[read_file]'));
      assert.ok(result[1].content.includes('chars'));
      assert.ok(result[1]._pruned);
    });

    it('preserves recent tool outputs unchanged', () => {
      const opt = new SmartOptimizerTransformer({ toolPruningMaxAge: 5 });
      const messages = [
        { role: 'assistant', tool_calls: [{ id: 't1', function: { name: 'terminal' } }] },
        { role: 'tool', tool_call_id: 't1', content: 'keep me' },
      ];
      const result = opt._pruneToolOutputs(messages);
      assert.strictEqual(result[1].content, 'keep me');
      assert.ok(!result[1]._pruned);
    });

    it('uses default summary format for unknown tools', () => {
      const opt = new SmartOptimizerTransformer({ toolPruningMaxAge: 1 });
      const messages = [
        { role: 'assistant', tool_calls: [{ id: 'u1', function: { name: 'unknown_tool' } }] },
        { role: 'tool', tool_call_id: 'u1', content: 'x'.repeat(300) },
        { role: 'user', content: 'next' },
        { role: 'assistant', content: 'thinking' },
      ];
      const result = opt._pruneToolOutputs(messages);
      assert.ok(result[1].content.includes('[unknown_tool]'));
      assert.ok(result[1].content.includes('chars'));
      assert.ok(result[1]._pruned);
    });

    it('passes through when disabled', () => {
      const opt = new SmartOptimizerTransformer({ enableToolPruning: false, toolPruningMaxAge: 1 });
      const messages = [
        { role: 'assistant', tool_calls: [{ id: 't1', function: { name: 'terminal' } }] },
        { role: 'tool', tool_call_id: 't1', content: 'x'.repeat(300) },
        { role: 'user', content: 'next' },
        { role: 'assistant', content: 'thinking' },
      ];
      const result = opt._pruneToolOutputs(messages);
      assert.strictEqual(result[1].content, 'x'.repeat(300));
      assert.ok(!result[1]._pruned);
    });
  });

  describe('_distillHistory', () => {
    it('summarizes intermediate messages and keeps footer', async () => {
      const opt = new SmartOptimizerTransformer({
        enableDistillation: true,
      });

      // Mock _runSummarizer
      opt._runSummarizer = async () => 'Technical summary content';

      const messages = [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'm1' },
        { role: 'user', content: 'm2' },
        { role: 'assistant', content: 'm3' },
        { role: 'user', content: 'm4' },
        { role: 'assistant', content: 'm5' },
        { role: 'user', content: 'm6' },
        { role: 'assistant', content: 'm7' },
        { role: 'user', content: 'm8' }, //Conversation start
        { role: 'assistant', content: 'f1' },
        { role: 'user', content: 'f2' },
        { role: 'assistant', content: 'f3' },
        { role: 'user', content: 'f4' },
        { role: 'assistant', content: 'f5' },
        { role: 'user', content: 'f6' },
        { role: 'assistant', content: 'f7' },
        { role: 'user', content: 'f8' },
      ];

      const result = await opt._distillHistory(messages, 100);

      assert.strictEqual(result[0].content, 'system');
      assert.strictEqual(result[1].content, 'first');
      assert.ok(result[2].content.includes('Technical summary content'));
      assert.ok(result[2]._distilled);
      // Verify footer remains (last 8 messages)
      assert.strictEqual(result[result.length - 1].content, 'f8');
      assert.strictEqual(result[result.length - 8].content, 'f1');
    });

    it('returns original messages if conversation too short', async () => {
      const opt = new SmartOptimizerTransformer({ enableDistillation: true });
      const messages = [{ role: 'user', content: 'hi' }];
      const result = await opt._distillHistory(messages, 100);
      assert.deepStrictEqual(result, messages);
    });

    it('detects existing summary and only sends new turns to summarizer', async () => {
      const opt = new SmartOptimizerTransformer({ enableDistillation: true });

      let receivedText = '';
      let receivedExistingSummary = '';
      opt._runSummarizer = async (text, existingSummary = '') => {
        receivedText = text;
        receivedExistingSummary = existingSummary;
        return 'Updated summary';
      };

      const messages = [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'm1' },
        { role: 'user', content: 'm2' },
        { role: 'assistant', content: 'm3' },
        { role: 'user', content: 'm4' },
        { role: 'assistant', content: 'm5' },
        { role: 'user', content: 'm6' },
        { role: 'assistant', content: 'm7' },
        { role: 'user', content: 'm8' },
        // Existing summary at index 10 (after 10 non-system messages)
        { role: 'user', content: '<ccr-context-summary>\nOld summary content\n</ccr-context-summary>', _distilled: true },
        { role: 'assistant', content: 'n1' },
        { role: 'user', content: 'n2' },
        { role: 'assistant', content: 'n3' },
        { role: 'user', content: 'n4' },
        { role: 'assistant', content: 'n5' },
        { role: 'user', content: 'n6' },
        { role: 'assistant', content: 'n7' },
        { role: 'user', content: 'n8' },
        { role: 'assistant', content: 'n9' },
        { role: 'user', content: 'n10' },
        { role: 'assistant', content: 'n11' },
        { role: 'user', content: 'n12' },
      ];

      const result = await opt._distillHistory(messages, 100);

      // Should have received the existing summary
      assert.strictEqual(receivedExistingSummary, 'Old summary content');
      // Should only contain new turns (before footer), not old messages
      assert.ok(!receivedText.includes('[USER]: first'), 'should not include old turns');
      assert.ok(receivedText.includes('[ASSISTANT]: n1'), 'should include new turns');

      // Structure: system + prefix (10 messages) + new summary + footer (8 messages)
      assert.strictEqual(result[0].content, 'system');
      assert.strictEqual(result[1].content, 'first');
      // The new summary should replace the old one in-place
      const summaryIdx = result.findIndex(m => m._distilled);
      assert.ok(summaryIdx >= 0, 'should have new summary');
      assert.ok(result[summaryIdx].content.includes('Updated summary'));
      assert.ok(!result.some((m, i) => i !== summaryIdx && m.content && m.content.includes('Old summary content')));
      // Footer should be last 8 of new turns
      assert.strictEqual(result[result.length - 1].content, 'n12');
      assert.strictEqual(result[result.length - 8].content, 'n5');
    });

    it('falls back to full summarization when no existing summary found', async () => {
      const opt = new SmartOptimizerTransformer({ enableDistillation: true });

      let receivedExistingSummary = 'SHOULD_NOT_BE_SET';
      opt._runSummarizer = async (text, existingSummary = '') => {
        receivedExistingSummary = existingSummary;
        return 'Full summary';
      };

      const messages = [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'm1' },
        { role: 'user', content: 'm2' },
        { role: 'assistant', content: 'm3' },
        { role: 'user', content: 'm4' },
        { role: 'assistant', content: 'm5' },
        { role: 'user', content: 'm6' },
        { role: 'assistant', content: 'm7' },
        { role: 'user', content: 'm8' },
        { role: 'assistant', content: 'f1' },
        { role: 'user', content: 'f2' },
        { role: 'assistant', content: 'f3' },
        { role: 'user', content: 'f4' },
        { role: 'assistant', content: 'f5' },
        { role: 'user', content: 'f6' },
        { role: 'assistant', content: 'f7' },
        { role: 'user', content: 'f8' },
      ];

      const result = await opt._distillHistory(messages, 100);

      assert.strictEqual(receivedExistingSummary, '', 'should not receive existing summary in fallback');
      assert.ok(result[2].content.includes('Full summary'));
      assert.ok(result[2]._distilled);
    });

    it('detects existing summary by _distilled flag without ccr-context-summary tag', async () => {
      const opt = new SmartOptimizerTransformer({ enableDistillation: true });

      let receivedExistingSummary = '';
      opt._runSummarizer = async (text, existingSummary = '') => {
        receivedExistingSummary = existingSummary;
        return 'Updated summary';
      };

      const messages = [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'm1' },
        { role: 'user', content: 'm2' },
        { role: 'assistant', content: 'm3' },
        { role: 'user', content: 'm4' },
        { role: 'assistant', content: 'm5' },
        { role: 'user', content: 'm6' },
        { role: 'assistant', content: 'm7' },
        { role: 'user', content: 'm8' },
        // Existing summary without ccr-context-summary tag but with _distilled flag
        { role: 'user', content: 'Previous summary text', _distilled: true },
        { role: 'assistant', content: 'n1' },
        { role: 'user', content: 'n2' },
        { role: 'assistant', content: 'n3' },
        { role: 'user', content: 'n4' },
        { role: 'assistant', content: 'n5' },
        { role: 'user', content: 'n6' },
        { role: 'assistant', content: 'n7' },
        { role: 'user', content: 'n8' },
        { role: 'assistant', content: 'n9' },
        { role: 'user', content: 'n10' },
        { role: 'assistant', content: 'n11' },
        { role: 'user', content: 'n12' },
      ];

      const result = await opt._distillHistory(messages, 100);

      // When _distilled is true but no ccr-context-summary tag, existing summary should be empty
      assert.strictEqual(receivedExistingSummary, '');
      // Should still replace old summary in-place
      const summaryIdx = result.findIndex(m => m._distilled);
      assert.ok(summaryIdx >= 0);
      assert.ok(result[summaryIdx].content.includes('Updated summary'));
    });

    it('returns original messages when not enough new turns after existing summary', async () => {
      const opt = new SmartOptimizerTransformer({ enableDistillation: true });
      opt._runSummarizer = async () => 'should not be called';

      const messages = [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'm1' },
        { role: 'user', content: 'm2' },
        { role: 'assistant', content: 'm3' },
        { role: 'user', content: 'm4' },
        { role: 'assistant', content: 'm5' },
        { role: 'user', content: 'm6' },
        { role: 'assistant', content: 'm7' },
        { role: 'user', content: 'm8' },
        { role: 'user', content: '<ccr-context-summary>\nOld summary\n</ccr-context-summary>', _distilled: true },
        // Only 3 new turns - too few to summarize
        { role: 'assistant', content: 'n1' },
        { role: 'user', content: 'n2' },
        { role: 'assistant', content: 'n3' },
      ];

      const result = await opt._distillHistory(messages, 100);
      assert.deepStrictEqual(result, messages);
    });
  });
});