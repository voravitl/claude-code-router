'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const DiffInspectorTransformer = require('../diff-inspector.transformer');

function makeRequest(messages, system) {
  const req = { messages: JSON.parse(JSON.stringify(messages)) };
  if (system) req.system = system;
  return req;
}

describe('DiffInspectorTransformer', () => {
  describe('disabled by default', () => {
    it('passes request through unchanged when disabled', async () => {
      const t = new DiffInspectorTransformer();
      const req = makeRequest([{ role: 'user', content: 'hello' }]);
      const ctx = {};
      const out = await t.transformRequestIn(req, 'anthropic', ctx);
      assert.deepEqual(out, req);
      assert.equal(ctx._diffOriginal, undefined);
    });
  });

  describe('enabled mode', () => {
    it('snapshots original in context on transformRequestIn', async () => {
      const t = new DiffInspectorTransformer({ enabled: true });
      const req = makeRequest([{ role: 'user', content: 'original text' }]);
      const ctx = {};
      await t.transformRequestIn(req, 'anthropic', ctx);
      assert.ok(ctx._diffOriginal, 'should store _diffOriginal');
      assert.equal(ctx._diffOriginal.messages[0].content, 'original text');
    });

    it('snapshot is a deep copy (not reference)', async () => {
      const t = new DiffInspectorTransformer({ enabled: true });
      const req = makeRequest([{ role: 'user', content: 'original' }]);
      const ctx = {};
      await t.transformRequestIn(req, 'anthropic', ctx);
      req.messages[0].content = 'mutated';
      assert.equal(ctx._diffOriginal.messages[0].content, 'original');
    });

    it('emits diff to stderr on transformRequestOut', async () => {
      const t = new DiffInspectorTransformer({ enabled: true });
      const original = makeRequest([{ role: 'user', content: 'short' }]);
      const optimized = makeRequest([{ role: 'user', content: 'short but more optimized with extra detail added here' }]);
      const ctx = { _diffOriginal: original };

      let emitted = '';
      const origWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (chunk) => { emitted += chunk; return true; };
      try {
        await t.transformRequestOut(optimized, 'anthropic', ctx);
      } finally {
        process.stderr.write = origWrite;
      }

      assert.ok(emitted.includes('ORIGINAL'), 'should contain ORIGINAL section');
      assert.ok(emitted.includes('OPTIMIZED'), 'should contain OPTIMIZED section');
      assert.ok(emitted.includes('Token delta'), 'should show token delta');
    });

    it('writes to file when output=file', async () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const logFile = path.join(os.tmpdir(), `ccr-diff-test-${Date.now()}.log`);

      const t = new DiffInspectorTransformer({ enabled: true, output: 'file', logFile });
      const original = makeRequest([{ role: 'user', content: 'hello world' }]);
      const optimized = makeRequest([{ role: 'user', content: 'hello world improved' }]);
      const ctx = { _diffOriginal: original };

      await t.transformRequestOut(optimized, 'anthropic', ctx);

      assert.ok(fs.existsSync(logFile), 'log file should be created');
      const content = fs.readFileSync(logFile, 'utf8');
      assert.ok(content.includes('ORIGINAL'), 'log should contain ORIGINAL');
      fs.unlinkSync(logFile);
    });

    it('handles missing _diffOriginal gracefully (no throw)', async () => {
      const t = new DiffInspectorTransformer({ enabled: true });
      const req = makeRequest([{ role: 'user', content: 'hello' }]);
      // No ctx._diffOriginal set
      await assert.doesNotReject(() => t.transformRequestOut(req, 'anthropic', {}));
    });

    it('detects system prompt change', async () => {
      const t = new DiffInspectorTransformer({ enabled: true });
      const original = makeRequest([{ role: 'user', content: 'hi' }], 'old system');
      const optimized = makeRequest([{ role: 'user', content: 'hi' }], 'new longer system prompt with more details');
      const ctx = { _diffOriginal: original };

      let emitted = '';
      const origWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (chunk) => { emitted += chunk; return true; };
      try {
        await t.transformRequestOut(optimized, 'anthropic', ctx);
      } finally {
        process.stderr.write = origWrite;
      }

      assert.ok(emitted.includes('SYSTEM PROMPT MODIFIED'), 'should detect system prompt change');
    });

    it('shows savings message when tokens reduced', async () => {
      const t = new DiffInspectorTransformer({ enabled: true, showTokenDelta: true });
      const longText = 'word '.repeat(500);
      const shortText = 'concise summary';
      const original = makeRequest([{ role: 'user', content: longText }]);
      const optimized = makeRequest([{ role: 'user', content: shortText }]);
      const ctx = { _diffOriginal: original };

      let emitted = '';
      const origWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (chunk) => { emitted += chunk; return true; };
      try {
        await t.transformRequestOut(optimized, 'anthropic', ctx);
      } finally {
        process.stderr.write = origWrite;
      }

      assert.ok(emitted.includes('Savings'), 'should show savings message');
    });

    it('passthrough response unchanged', async () => {
      const t = new DiffInspectorTransformer({ enabled: true });
      const resp = { choices: [{ message: { content: 'hello' } }] };
      const out = await t.transformResponseOut(resp, {});
      assert.deepEqual(out, resp);
    });
  });
});
