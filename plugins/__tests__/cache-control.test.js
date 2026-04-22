const { describe, it } = require('node:test');
const assert = require('node:assert');
const CacheControlTransformer = require('../cache-control.transformer.js');

function longText(len) {
  return 'a'.repeat(len);
}

const BLOCK = (text) => ({ type: 'text', text });
const THINKING = (text) => ({ type: 'thinking', text });

describe('CacheControlTransformer', () => {
  it('has correct name property', () => {
    const t = new CacheControlTransformer();
    assert.strictEqual(t.name, 'cache-control');
  });

  it('marks breakpoints on Anthropic provider (hybrid mode: 3 explicit + 1 auto)', async () => {
    const t = new CacheControlTransformer({ mode: 'hybrid' });
    const request = {
      messages: [
        { role: 'system', content: [BLOCK(longText(4096))] },
        { role: 'user', content: [BLOCK(longText(4096))] },
        { role: 'assistant', content: [BLOCK(longText(4096))] },
        { role: 'user', content: [BLOCK(longText(4096))] },
        { role: 'assistant', content: [BLOCK(longText(4096))] },
      ]
    };

    const result = await t.transformRequestIn(request, { name: 'anthropic' });

    // Hybrid mode reserves 1 breakpoint for auto-caching, so 3 explicit breakpoints max
    assert.deepStrictEqual(result.messages[0].content[0].cache_control, { type: 'ephemeral' });
    assert.deepStrictEqual(result.messages[1].content[0].cache_control, { type: 'ephemeral' });
    assert.deepStrictEqual(result.messages[2].content[0].cache_control, { type: 'ephemeral' });
    // 4th message (2nd user) may or may not get a breakpoint depending on threshold
    // Last assistant should not (only 3 explicit in hybrid)
    assert.strictEqual(result.messages[4].content[0].cache_control, undefined);
    // Top-level auto-caching should be set
    assert.deepStrictEqual(result.cache_control, { type: 'ephemeral' });
  });

  it('marks up to 4 breakpoints in explicit mode', async () => {
    const t = new CacheControlTransformer({ mode: 'explicit' });
    const request = {
      messages: [
        { role: 'system', content: [BLOCK(longText(4096))] },
        { role: 'user', content: [BLOCK(longText(4096))] },
        { role: 'assistant', content: [BLOCK(longText(4096))] },
        { role: 'user', content: [BLOCK(longText(4096))] },
        { role: 'assistant', content: [BLOCK(longText(4096))] },
      ]
    };

    const result = await t.transformRequestIn(request, { name: 'anthropic' });

    assert.deepStrictEqual(result.messages[0].content[0].cache_control, { type: 'ephemeral' });
    assert.deepStrictEqual(result.messages[1].content[0].cache_control, { type: 'ephemeral' });
    assert.deepStrictEqual(result.messages[2].content[0].cache_control, { type: 'ephemeral' });
    assert.deepStrictEqual(result.messages[3].content[0].cache_control, { type: 'ephemeral' });
    assert.strictEqual(result.messages[4].content[0].cache_control, undefined);
  });

  it('disabled: passthrough', async () => {
    const t = new CacheControlTransformer({ enabled: false });
    const request = {
      messages: [
        { role: 'system', content: [BLOCK(longText(4096))] },
        { role: 'user', content: [BLOCK(longText(4096))] },
      ]
    };

    const result = await t.transformRequestIn(request, { name: 'anthropic' });

    assert.strictEqual(result.messages[0].content[0].cache_control, undefined);
    assert.strictEqual(result.messages[1].content[0].cache_control, undefined);
  });

  it('non-Anthropic provider: passthrough', async () => {
    const t = new CacheControlTransformer();
    const request = {
      messages: [
        { role: 'system', content: [BLOCK(longText(4096))] },
        { role: 'user', content: [BLOCK(longText(4096))] },
      ]
    };

    const result = await t.transformRequestIn(request, { name: 'ollama' });

    assert.strictEqual(result.messages[0].content[0].cache_control, undefined);
    assert.strictEqual(result.messages[1].content[0].cache_control, undefined);
  });

  it('idempotent: skips if cache_control already present', async () => {
    const t = new CacheControlTransformer();
    const request = {
      messages: [
        { role: 'system', content: [BLOCK(longText(4096))] },
        { role: 'user', content: [{ type: 'text', text: longText(4096), cache_control: { type: 'ephemeral' } }] },
        { role: 'assistant', content: [BLOCK(longText(4096))] },
      ]
    };

    const result = await t.transformRequestIn(request, { name: 'anthropic' });

    assert.deepStrictEqual(result.messages[0].content[0].cache_control, { type: 'ephemeral' });
    assert.deepStrictEqual(result.messages[1].content[0].cache_control, { type: 'ephemeral' });
    assert.deepStrictEqual(result.messages[2].content[0].cache_control, { type: 'ephemeral' });
  });

  it('skips thinking blocks and marks next eligible', async () => {
    const t = new CacheControlTransformer();
    const request = {
      messages: [
        { role: 'system', content: [THINKING(longText(4096)), BLOCK(longText(4096))] },
      ]
    };

    const result = await t.transformRequestIn(request, { name: 'anthropic' });

    assert.strictEqual(result.messages[0].content[0].cache_control, undefined);
    assert.deepStrictEqual(result.messages[0].content[1].cache_control, { type: 'ephemeral' });
  });

  it('wraps string content into array blocks', async () => {
    const t = new CacheControlTransformer();
    const request = {
      messages: [
        { role: 'system', content: longText(4096) },
      ]
    };

    const result = await t.transformRequestIn(request, { name: 'anthropic' });

    assert.ok(Array.isArray(result.messages[0].content));
    assert.strictEqual(result.messages[0].content[0].type, 'text');
    assert.deepStrictEqual(result.messages[0].content[0].cache_control, { type: 'ephemeral' });
  });

  it('respects minimum token threshold', async () => {
    const t = new CacheControlTransformer();
    const request = {
      messages: [
        { role: 'system', content: [BLOCK(longText(4096))] },
        { role: 'user', content: [BLOCK('short')] },
      ]
    };

    const result = await t.transformRequestIn(request, { name: 'anthropic' });

    assert.deepStrictEqual(result.messages[0].content[0].cache_control, { type: 'ephemeral' });
    assert.strictEqual(result.messages[1].content[0].cache_control, undefined);
  });

  it('supports provider as string', async () => {
    const t = new CacheControlTransformer();
    const request = {
      messages: [
        { role: 'system', content: [BLOCK(longText(4096))] },
      ]
    };

    const result = await t.transformRequestIn(request, 'anthropic');

    assert.deepStrictEqual(result.messages[0].content[0].cache_control, { type: 'ephemeral' });
  });

  it('passthrough when no messages', async () => {
    const t = new CacheControlTransformer();
    const request = {};

    const result = await t.transformRequestIn(request, { name: 'anthropic' });

    assert.deepStrictEqual(result, {});
  });

  it('transformResponseOut returns response unchanged', async () => {
    const t = new CacheControlTransformer();
    const response = { foo: 'bar' };

    const result = await t.transformResponseOut(response);

    assert.strictEqual(result, response);
  });
});