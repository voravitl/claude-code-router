const { describe, it } = require('node:test');
const assert = require('node:assert');
const ResponseOptimizerTransformer = require('../response-optimizer.transformer.js');

describe('ResponseOptimizerTransformer', () => {
  describe('constructor', () => {
    it('defaults enableMetadata and enableErrorEnhancement to false', () => {
      const ro = new ResponseOptimizerTransformer();
      assert.strictEqual(ro.options.enableMetadata, false);
      assert.strictEqual(ro.options.enableErrorEnhancement, false);
    });

    it('accepts custom options', () => {
      const ro = new ResponseOptimizerTransformer({ enableMetadata: true, enableErrorEnhancement: true });
      assert.strictEqual(ro.options.enableMetadata, true);
      assert.strictEqual(ro.options.enableErrorEnhancement, true);
    });
  });

  describe('transformResponseOut — passthrough', () => {
    it('passes through with default options (both disabled)', async () => {
      const ro = new ResponseOptimizerTransformer();
      const response = { choices: [{ message: { content: 'hello', role: 'assistant' } }] };
      const result = await ro.transformResponseOut(response, {});
      assert.deepStrictEqual(result, response);
    });

    it('passes through null response', async () => {
      const ro = new ResponseOptimizerTransformer();
      const result = await ro.transformResponseOut(null, {});
      assert.strictEqual(result, null);
    });
  });

  describe('transformResponseOut — reasoning merge', () => {
    it('merges reasoning into content when content is empty string', async () => {
      const ro = new ResponseOptimizerTransformer();
      const response = {
        choices: [{
          message: { content: '', reasoning: 'I think step by step', role: 'assistant' },
        }],
      };
      const result = await ro.transformResponseOut(response, {});
      assert.strictEqual(result.choices[0].message.content, 'I think step by step');
      assert.strictEqual(result.choices[0].message.reasoning, undefined);
    });

    it('preserves normal content when both content and reasoning exist', async () => {
      const ro = new ResponseOptimizerTransformer();
      const response = {
        choices: [{
          message: { content: 'The answer is 42', reasoning: 'I thought about it', role: 'assistant' },
        }],
      };
      const result = await ro.transformResponseOut(response, {});
      assert.strictEqual(result.choices[0].message.content, 'The answer is 42');
      assert.strictEqual(result.choices[0].message.reasoning, 'I thought about it');
    });

    it('does not merge when content is non-empty', async () => {
      const ro = new ResponseOptimizerTransformer();
      const response = {
        choices: [{
          message: { content: 'some content', reasoning: 'thinking', role: 'assistant' },
        }],
      };
      const result = await ro.transformResponseOut(response, {});
      assert.strictEqual(result.choices[0].message.content, 'some content');
    });
  });

  describe('transformResponseOut — with metadata enabled', () => {
    it('adds _metadata when enableMetadata is true and requestInfo in context', async () => {
      const ro = new ResponseOptimizerTransformer({ enableMetadata: true });
      const response = { choices: [{ message: { content: 'hi', role: 'assistant' } }] };
      // This path requires JSON content-type headers — plain objects without headers go through early
      // For the metadata path to trigger, the response needs headers with Content-Type: application/json
      const jsonResponse = {
        headers: { 'Content-Type': 'application/json' },
        choices: [{ message: { content: 'hi', role: 'assistant' } }],
      };
      const result = await ro.transformResponseOut(jsonResponse, { requestInfo: { model: 'test' } });
      assert.ok(result._metadata, 'should add _metadata');
      assert.strictEqual(result._metadata.optimized, true);
    });
  });

  describe('enhanceErrorResponse', () => {
    it('adds context with retry info for rate_limit_error', () => {
      const ro = new ResponseOptimizerTransformer({ enableErrorEnhancement: true });
      const error = { type: 'rate_limit_error', code: 429, message: 'Too many requests' };
      const enhanced = ro.enhanceErrorResponse(error);
      assert.strictEqual(enhanced.context.isRetryable, true);
      assert.strictEqual(enhanced.context.suggestedAction, 'retry_after_delay');
    });

    it('marks server_error as retryable', () => {
      const ro = new ResponseOptimizerTransformer({ enableErrorEnhancement: true });
      const enhanced = ro.enhanceErrorResponse({ type: 'server_error' });
      assert.strictEqual(enhanced.context.isRetryable, true);
      assert.strictEqual(enhanced.context.suggestedAction, 'retry_with_backoff');
    });

    it('marks authentication_error as not retryable', () => {
      const ro = new ResponseOptimizerTransformer({ enableErrorEnhancement: true });
      const enhanced = ro.enhanceErrorResponse({ type: 'authentication_error' });
      assert.strictEqual(enhanced.context.isRetryable, false);
      assert.strictEqual(enhanced.context.suggestedAction, 'check_credentials');
    });

    it('handles null error object', () => {
      const ro = new ResponseOptimizerTransformer({ enableErrorEnhancement: true });
      const enhanced = ro.enhanceErrorResponse(null);
      assert.strictEqual(enhanced.context.errorType, 'unknown');
      assert.strictEqual(enhanced.context.isRetryable, false);
    });
  });

  describe('_calculateBackoff', () => {
    it('returns a value between 0 and cap', () => {
      const ro = new ResponseOptimizerTransformer({ enableRetry: true, baseDelayMs: 1000, maxDelayMs: 60000 });
      for (let i = 0; i < 10; i++) {
        const delay = ro._calculateBackoff(0);
        assert.ok(delay >= 0, 'delay should be >= 0');
        assert.ok(delay <= 60000, 'delay should be <= cap');
      }
    });

    it('increases with higher attempt numbers', () => {
      const ro = new ResponseOptimizerTransformer({ enableRetry: true, baseDelayMs: 1000, maxDelayMs: 60000 });
      const delays = [];
      for (let attempt = 0; attempt < 5; attempt++) {
        let sum = 0;
        for (let i = 0; i < 100; i++) {
          sum += ro._calculateBackoff(attempt);
        }
        delays.push(sum / 100);
      }
      // Average delay should generally increase with attempt (monotonic trend)
      assert.ok(delays[1] > delays[0], 'attempt 1 avg should be > attempt 0 avg');
      assert.ok(delays[2] > delays[1], 'attempt 2 avg should be > attempt 1 avg');
    });

    it('respects maxDelayMs cap', () => {
      const ro = new ResponseOptimizerTransformer({ enableRetry: true, baseDelayMs: 1000, maxDelayMs: 5000 });
      for (let i = 0; i < 50; i++) {
        const delay = ro._calculateBackoff(10); // high attempt
        assert.ok(delay <= 5000, 'delay should respect cap');
      }
    });
  });

  describe('_parseRetryAfter', () => {
    it('parses Retry-After header from plain object', () => {
      const ro = new ResponseOptimizerTransformer();
      const result = ro._parseRetryAfter({ 'retry-after': '5' });
      assert.strictEqual(result, 5000);
    });

    it('parses Retry-After header from Headers object', () => {
      const ro = new ResponseOptimizerTransformer();
      const headers = new Map();
      headers.set('retry-after', '10');
      headers.get = (key) => (key === 'retry-after' ? '10' : null);
      const result = ro._parseRetryAfter(headers);
      assert.strictEqual(result, 10000);
    });

    it('returns null for missing header', () => {
      const ro = new ResponseOptimizerTransformer();
      assert.strictEqual(ro._parseRetryAfter({}), null);
      assert.strictEqual(ro._parseRetryAfter(null), null);
    });

    it('returns null for non-numeric value', () => {
      const ro = new ResponseOptimizerTransformer();
      assert.strictEqual(ro._parseRetryAfter({ 'retry-after': 'soon' }), null);
    });
  });

  describe('transformResponseOut — retry logic', () => {
    it('returns retry metadata for 429 response', async () => {
      const ro = new ResponseOptimizerTransformer({ enableRetry: true });
      const response = { status: 429, choices: [] };
      const result = await ro.transformResponseOut(response, {});
      assert.ok(result._retry, 'should have _retry');
      assert.ok(result._retry.delay >= 0, 'delay should be >= 0');
      assert.strictEqual(result._retry.attempt, 1);
    });

    it('returns retry metadata for 503 response', async () => {
      const ro = new ResponseOptimizerTransformer({ enableRetry: true });
      const response = { status: 503, choices: [] };
      const result = await ro.transformResponseOut(response, {});
      assert.ok(result._retry, 'should have _retry');
      assert.ok(result._retry.delay >= 0, 'delay should be >= 0');
      assert.strictEqual(result._retry.attempt, 1);
    });

    it('respects Retry-After header for 429', async () => {
      const ro = new ResponseOptimizerTransformer({ enableRetry: true });
      const response = { status: 429, headers: { 'retry-after': '5' }, choices: [] };
      const result = await ro.transformResponseOut(response, {});
      assert.ok(result._retry, 'should have _retry');
      assert.strictEqual(result._retry.delay, 5000);
      assert.strictEqual(result._retry.attempt, 1);
    });

    it('respects Retry-After header for 503', async () => {
      const ro = new ResponseOptimizerTransformer({ enableRetry: true });
      const response = { status: 503, headers: { 'retry-after': '10' }, choices: [] };
      const result = await ro.transformResponseOut(response, {});
      assert.ok(result._retry, 'should have _retry');
      assert.strictEqual(result._retry.delay, 10000);
      assert.strictEqual(result._retry.attempt, 1);
    });

    it('does not retry when enableRetry is false', async () => {
      const ro = new ResponseOptimizerTransformer({ enableRetry: false });
      const response = { status: 429, choices: [] };
      const result = await ro.transformResponseOut(response, {});
      assert.strictEqual(result._retry, undefined);
    });

    it('does not retry for non-retryable status codes', async () => {
      const ro = new ResponseOptimizerTransformer({ enableRetry: true });
      const response = { status: 400, choices: [] };
      const result = await ro.transformResponseOut(response, {});
      assert.strictEqual(result._retry, undefined);
    });

    it('increments attempt from context', async () => {
      const ro = new ResponseOptimizerTransformer({ enableRetry: true });
      const response = { status: 429, choices: [] };
      const result = await ro.transformResponseOut(response, { retryAttempt: 2 });
      assert.strictEqual(result._retry.attempt, 3);
    });

    it('does not retry when maxRetries exceeded', async () => {
      const ro = new ResponseOptimizerTransformer({ enableRetry: true, maxRetries: 2 });
      const response = { status: 429, choices: [] };
      const result = await ro.transformResponseOut(response, { retryAttempt: 2 });
      assert.strictEqual(result._retry, undefined);
    });

    it('retries on retryable error types', async () => {
      const ro = new ResponseOptimizerTransformer({ enableRetry: true });
      const response = { error: { type: 'rate_limit_error' }, choices: [] };
      const result = await ro.transformResponseOut(response, {});
      assert.ok(result._retry, 'should have _retry for rate_limit_error');
    });

    it('does not retry on non-retryable error types', async () => {
      const ro = new ResponseOptimizerTransformer({ enableRetry: true });
      const response = { error: { type: 'authentication_error' }, choices: [] };
      const result = await ro.transformResponseOut(response, {});
      assert.strictEqual(result._retry, undefined);
    });
  });
});