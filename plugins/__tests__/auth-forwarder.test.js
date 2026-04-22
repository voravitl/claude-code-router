const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const AuthForwarderTransformer = require('../auth-forwarder.transformer.js');

describe('AuthForwarderTransformer', () => {
  let savedAnthropicKey;

  beforeEach(() => {
    savedAnthropicKey = process.env.ANTHROPIC_KEY;
    delete process.env.ANTHROPIC_KEY;
  });

  afterEach(() => {
    if (savedAnthropicKey !== undefined) {
      process.env.ANTHROPIC_KEY = savedAnthropicKey;
    } else {
      delete process.env.ANTHROPIC_KEY;
    }
  });

  it('uses x-api-key for Anthropic provider with anthropic-version header', async () => {
    const auth = new AuthForwarderTransformer();
    const result = await auth.auth({ model: 'claude-sonnet-4-6' }, { name: 'anthropic', apiKey: 'sk-ant-123' });
    assert.strictEqual(result.config.headers['x-api-key'], 'sk-ant-123');
    assert.strictEqual(result.config.headers['anthropic-version'], '2023-06-01');
    assert.ok(!result.config.headers.authorization, 'should not have authorization for anthropic');
  });

  it('prefers ANTHROPIC_KEY env var over config api_key', async () => {
    process.env.ANTHROPIC_KEY = 'sk-ant-from-env';
    const auth = new AuthForwarderTransformer();
    const result = await auth.auth({ model: 'claude-sonnet-4-6' }, { name: 'anthropic', apiKey: 'sk-ant-from-config' });
    assert.strictEqual(result.config.headers['x-api-key'], 'sk-ant-from-env');
  });

  it('uses x-api-key for Ollama provider', async () => {
    const auth = new AuthForwarderTransformer();
    const result = await auth.auth({ model: 'test' }, { name: 'ollama', apiKey: 'ollama' });
    assert.strictEqual(result.config.headers['x-api-key'], 'ollama');
    assert.ok(!result.config.headers.authorization, 'should not have authorization for ollama');
  });

  it('defaults x-api-key to "ollama" when no provider apiKey', async () => {
    const auth = new AuthForwarderTransformer();
    const result = await auth.auth({ model: 'test' }, {});
    assert.strictEqual(result.config.headers['x-api-key'], 'ollama');
  });

  it('passes body through unchanged', async () => {
    const auth = new AuthForwarderTransformer();
    const body = { model: 'test', messages: [{ role: 'user', content: 'hi' }] };
    const result = await auth.auth(body, { apiKey: 'sk-key' });
    assert.deepStrictEqual(result.body, body);
  });

  it('does not produce undefined header values', async () => {
    const auth = new AuthForwarderTransformer();
    const result = await auth.auth({ model: 'test' }, {});
    const headers = result.config.headers;
    for (const [key, value] of Object.entries(headers)) {
      assert.ok(value !== undefined, `header "${key}" should not be undefined`);
      assert.ok(value !== null, `header "${key}" should not be null`);
    }
  });

  it('supports provider.api_key (snake_case) as fallback', async () => {
    const auth = new AuthForwarderTransformer();
    const result = await auth.auth({ model: 'test' }, { api_key: 'snake-key' });
    assert.strictEqual(result.config.headers['x-api-key'], 'snake-key');
  });

  it('prefers apiKey over api_key', async () => {
    const auth = new AuthForwarderTransformer();
    const result = await auth.auth({ model: 'test' }, { apiKey: 'camel-key', api_key: 'snake-key' });
    assert.strictEqual(result.config.headers['x-api-key'], 'camel-key');
  });

  it('has correct name property', () => {
    const auth = new AuthForwarderTransformer();
    assert.strictEqual(auth.name, 'AuthForwarder');
  });

  it('ignores ANTHROPIC_AUTH_TOKEN env var (used by CCR for Ollama)', async () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'ollama';
    const auth = new AuthForwarderTransformer();
    const result = await auth.auth({ model: 'claude-sonnet-4-6' }, { name: 'anthropic', apiKey: 'sk-ant-real' });
    assert.strictEqual(result.config.headers['x-api-key'], 'sk-ant-real');
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  });

  it('routes gemini-oauth provider to OAuth path', async () => {
    const auth = new AuthForwarderTransformer();
    auth._resolveGeminiToken = async () => 'ya29.test-oauth-token';
    const result = await auth.auth({ model: 'gemini-2.5-pro' }, { name: 'gemini-oauth' });
    assert.strictEqual(result.config.headers['Authorization'], 'Bearer ya29.test-oauth-token');
    assert.ok(!result.config.headers['x-goog-api-key'], 'should not use x-goog-api-key for OAuth token');
  });

  it('uses Authorization Bearer for ya29 OAuth tokens', async () => {
    const auth = new AuthForwarderTransformer();
    auth._resolveGeminiToken = async () => 'ya29.abc123';
    const result = await auth.auth({ model: 'gemini-2.5-pro' }, { name: 'gemini' });
    assert.strictEqual(result.config.headers['Authorization'], 'Bearer ya29.abc123');
    assert.ok(!result.config.headers['x-goog-api-key'], 'should not have x-goog-api-key for OAuth tokens');
  });

  it('uses x-goog-api-key for non-OAuth API keys', async () => {
    const auth = new AuthForwarderTransformer();
    auth._resolveGeminiToken = async () => 'AIzaSyD-my-api-key';
    const result = await auth.auth({ model: 'gemini-2.5-pro' }, { name: 'gemini' });
    assert.strictEqual(result.config.headers['x-goog-api-key'], 'AIzaSyD-my-api-key');
    assert.ok(!result.config.headers['Authorization'], 'should not have Authorization header for API keys');
  });

  describe('Gemini OAuth credential caching', () => {
    let resolveCallCount;

    beforeEach(() => {
      resolveCallCount = 0;
    });

    it('first call invokes _resolveGeminiToken (cache miss)', async () => {
      const auth = new AuthForwarderTransformer();
      auth._resolveGeminiToken = async () => {
        resolveCallCount++;
        return 'ya29.mock-gemini-token';
      };
      const result = await auth.auth({ model: 'test' }, { name: 'gemini-oauth', apiKey: 'key1' });
      assert.strictEqual(resolveCallCount, 1);
      assert.strictEqual(result.config.headers['Authorization'], 'Bearer ya29.mock-gemini-token');
    });

    it('second call uses cache (no _resolveGeminiToken)', async () => {
      const auth = new AuthForwarderTransformer();
      auth._resolveGeminiToken = async () => {
        resolveCallCount++;
        return 'ya29.mock-gemini-token';
      };
      await auth.auth({ model: 'test' }, { name: 'gemini-oauth', apiKey: 'key1' });
      assert.strictEqual(resolveCallCount, 1);

      const result = await auth.auth({ model: 'test' }, { name: 'gemini-oauth', apiKey: 'key1' });
      assert.strictEqual(resolveCallCount, 1); // still 1, cached
      assert.strictEqual(result.config.headers['Authorization'], 'Bearer ya29.mock-gemini-token');
    });

    it('after TTL expires, _resolveGeminiToken is invoked again', async () => {
      const auth = new AuthForwarderTransformer({ credentialCacheTtlMs: 100 });
      auth._resolveGeminiToken = async () => {
        resolveCallCount++;
        return 'ya29.mock-gemini-token';
      };
      await auth.auth({ model: 'test' }, { name: 'gemini-oauth', apiKey: 'key1' });
      assert.strictEqual(resolveCallCount, 1);

      // Wait for TTL to expire
      await new Promise(r => setTimeout(r, 150));

      await auth.auth({ model: 'test' }, { name: 'gemini-oauth', apiKey: 'key1' });
      assert.strictEqual(resolveCallCount, 2);
    });

    it('invalidateCache evicts the cached entry', async () => {
      const auth = new AuthForwarderTransformer();
      auth._resolveGeminiToken = async () => {
        resolveCallCount++;
        return 'ya29.mock-gemini-token';
      };
      await auth.auth({ model: 'test' }, { name: 'gemini-oauth', apiKey: 'key1' });
      assert.strictEqual(resolveCallCount, 1);

      auth.invalidateCache('gemini-oauth', 'oauth');

      await auth.auth({ model: 'test' }, { name: 'gemini-oauth', apiKey: 'key1' });
      assert.strictEqual(resolveCallCount, 2);
    });

    it('different providers have separate cache entries', async () => {
      const auth = new AuthForwarderTransformer();
      auth._resolveGeminiToken = async () => {
        resolveCallCount++;
        return 'ya29.mock-gemini-token';
      };
      await auth.auth({ model: 'test' }, { name: 'gemini-oauth', apiKey: 'key1' });
      assert.strictEqual(resolveCallCount, 1);

      // Same call for 'gemini' provider should be a cache miss
      await auth.auth({ model: 'test' }, { name: 'gemini', apiKey: 'key1' });
      assert.strictEqual(resolveCallCount, 2);
    });

    it('disabled cache always invokes _resolveGeminiToken', async () => {
      const auth = new AuthForwarderTransformer({ enableCredentialCache: false });
      auth._resolveGeminiToken = async () => {
        resolveCallCount++;
        return 'ya29.mock-gemini-token';
      };
      await auth.auth({ model: 'test' }, { name: 'gemini-oauth', apiKey: 'key1' });
      assert.strictEqual(resolveCallCount, 1);

      await auth.auth({ model: 'test' }, { name: 'gemini-oauth', apiKey: 'key1' });
      assert.strictEqual(resolveCallCount, 2);
    });

    it('response hook invalidates cache on 401 for gemini-oauth', async () => {
      const auth = new AuthForwarderTransformer();
      auth._resolveGeminiToken = async () => {
        resolveCallCount++;
        return 'ya29.mock-gemini-token';
      };
      await auth.auth({ model: 'test' }, { name: 'gemini-oauth', apiKey: 'key1' });
      assert.strictEqual(resolveCallCount, 1);

      // Simulate 401 response
      await auth.response({ status: 401, error: 'Unauthorized' }, { name: 'gemini-oauth' });

      // Next auth should trigger a fresh token resolution
      await auth.auth({ model: 'test' }, { name: 'gemini-oauth', apiKey: 'key1' });
      assert.strictEqual(resolveCallCount, 2);
    });

    it('response hook invalidates cache on 401 for gemini', async () => {
      const auth = new AuthForwarderTransformer();
      auth._resolveGeminiToken = async () => {
        resolveCallCount++;
        return 'ya29.mock-gemini-token';
      };
      await auth.auth({ model: 'test' }, { name: 'gemini', apiKey: 'key1' });
      assert.strictEqual(resolveCallCount, 1);

      await auth.response({ statusCode: 401 }, { name: 'gemini' });

      await auth.auth({ model: 'test' }, { name: 'gemini', apiKey: 'key1' });
      assert.strictEqual(resolveCallCount, 2);
    });

    it('response hook does not invalidate on non-401 status', async () => {
      const auth = new AuthForwarderTransformer();
      auth._resolveGeminiToken = async () => {
        resolveCallCount++;
        return 'ya29.mock-gemini-token';
      };
      await auth.auth({ model: 'test' }, { name: 'gemini-oauth', apiKey: 'key1' });
      assert.strictEqual(resolveCallCount, 1);

      await auth.response({ status: 500, error: 'Server Error' }, { name: 'gemini-oauth' });

      await auth.auth({ model: 'test' }, { name: 'gemini-oauth', apiKey: 'key1' });
      assert.strictEqual(resolveCallCount, 1); // still cached
    });

    it('response hook does not invalidate for non-gemini providers', async () => {
      const auth = new AuthForwarderTransformer();
      auth._resolveGeminiToken = async () => {
        resolveCallCount++;
        return 'ya29.mock-gemini-token';
      };
      await auth.auth({ model: 'test' }, { name: 'gemini-oauth', apiKey: 'key1' });
      assert.strictEqual(resolveCallCount, 1);

      await auth.response({ status: 401 }, { name: 'anthropic' });

      await auth.auth({ model: 'test' }, { name: 'gemini-oauth', apiKey: 'key1' });
      assert.strictEqual(resolveCallCount, 1); // still cached
    });
  });
});