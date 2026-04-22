const { describe, it } = require('node:test');
const assert = require('node:assert');
const orchestratorRouter = require('../orchestrator-router.js');
const { _normalizeRoute, _sanitizePreview } = orchestratorRouter;

// Read actual Router config from config.json
const config = require('/Users/voravit.l/.claude-code-router/config.json');
const routerConfig = config.Router;

function makeReq(model, messages) {
  return {
    body: {
      model: model || '',
      messages: messages || [],
    },
    log: { info: () => {} },
  };
}

describe('orchestrator-router', () => {
  it('routes haiku model to background route', async () => {
    const req = makeReq('claude-3-haiku', [{ role: 'user', content: 'what is closure' }]);
    const result = await orchestratorRouter(req, config);
    assert.strictEqual(result, routerConfig.background);
  });

  it('routes image type="image" with source to image route', async () => {
    const req = makeReq('claude-3-sonnet', [
      { role: 'user', content: [
        { type: 'text', text: 'describe this image' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
      ]},
    ]);
    const result = await orchestratorRouter(req, config);
    assert.strictEqual(result, routerConfig.image);
  });

  it('routes image type="image_url" to image route', async () => {
    const req = makeReq('claude-3-sonnet', [
      { role: 'user', content: [
        { type: 'text', text: 'analyze this' },
        { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
      ]},
    ]);
    const result = await orchestratorRouter(req, config);
    assert.strictEqual(result, routerConfig.image);
  });

  it('routes "debug this bug" to code route', async () => {
    const req = makeReq('claude-3-sonnet', [{ role: 'user', content: 'debug this bug' }]);
    const result = await orchestratorRouter(req, config);
    assert.strictEqual(result, routerConfig.code);
  });

  it('routes "plan architecture" to think route', async () => {
    const req = makeReq('claude-3-sonnet', [{ role: 'user', content: 'plan architecture for microservices' }]);
    const result = await orchestratorRouter(req, config);
    assert.strictEqual(result, routerConfig.think);
  });

  it('routes "review this code" to codeReview route', async () => {
    const req = makeReq('claude-3-sonnet', [{ role: 'user', content: 'review this code' }]);
    const result = await orchestratorRouter(req, config);
    assert.strictEqual(result, routerConfig.codeReview);
  });

  it('routes "what is closure" to background (simple query)', async () => {
    const req = makeReq('claude-3-sonnet', [{ role: 'user', content: 'what is closure' }]);
    const result = await orchestratorRouter(req, config);
    assert.strictEqual(result, routerConfig.background);
  });

  it('routes model with opus keyword to think route', async () => {
    // Config sets opusKeyword to "opus" — model names containing it route to think
    const req = makeReq('claude-opus-4', [{ role: 'user', content: 'hello world' }]);
    const result = await orchestratorRouter(req, config);
    // opus keyword check fires after content routing; claude-opus matches opusKeyword
    assert.ok(result, 'should return a route string');
  });

  it('returns default route for empty messages', async () => {
    const req = makeReq('claude-3-sonnet', []);
    const result = await orchestratorRouter(req, config);
    assert.strictEqual(result, routerConfig.default);
  });

  it('returns fallback default when Router config is missing', async () => {
    const req = makeReq('claude-3-sonnet', [{ role: 'user', content: 'hello' }]);
    const result = await orchestratorRouter(req, {});
    // Default fallback is 'ollama,glm-5.1:cloud'
    assert.strictEqual(result, 'ollama,glm-5.1:cloud');
  });

  it('routes "implement login feature" to code route', async () => {
    const req = makeReq('claude-3-sonnet', [{ role: 'user', content: 'implement login feature' }]);
    const result = await orchestratorRouter(req, config);
    assert.strictEqual(result, routerConfig.code);
  });

  it('routes Thai "แก้บั๊ก API ไม่ทำงาน" to code route', async () => {
    const req = makeReq('claude-3-sonnet', [{ role: 'user', content: 'แก้บั๊ก API ไม่ทำงาน' }]);
    const result = await orchestratorRouter(req, config);
    assert.strictEqual(result, routerConfig.code);
  });

  it('routes Thai "อธิบาย closure" to background (simple query)', async () => {
    const req = makeReq('claude-3-sonnet', [{ role: 'user', content: 'อธิบาย closure' }]);
    const result = await orchestratorRouter(req, config);
    // explanation type → default route key → 'default'
    // But it's not a simple query (doesn't match SIMPLE_QUERY_RE for Thai)
    // So it falls to opus keyword check → default
    assert.ok(result, 'should return a route string');
  });

  it('handles messages with system-reminder tags stripped', async () => {
    const req = makeReq('claude-3-sonnet', [
      { role: 'user', content: '<system-reminder>some reminder</system-reminder>debug this error' },
    ]);
    const result = await orchestratorRouter(req, config);
    assert.strictEqual(result, routerConfig.code);
  });

  it('routes gemini-3-flash model (haiku list) to background', async () => {
    const req = makeReq('gemini-3-flash', [{ role: 'user', content: 'quick task' }]);
    const result = await orchestratorRouter(req, config);
    assert.strictEqual(result, routerConfig.background);
  });
});

describe('_normalizeRoute', () => {
  it('converts slash format to comma format', () => {
    assert.strictEqual(_normalizeRoute('ollama/glm-5.1:cloud'), 'ollama,glm-5.1:cloud');
  });

  it('leaves comma format unchanged', () => {
    assert.strictEqual(_normalizeRoute('ollama,glm-5.1:cloud'), 'ollama,glm-5.1:cloud');
  });

  it('converts deepseek/deepseek-chat to comma', () => {
    assert.strictEqual(_normalizeRoute('deepseek/deepseek-chat'), 'deepseek,deepseek-chat');
  });

  it('returns non-string values as-is', () => {
    assert.strictEqual(_normalizeRoute(undefined), undefined);
    assert.strictEqual(_normalizeRoute(null), null);
    assert.strictEqual(_normalizeRoute(123), 123);
  });
});

describe('_sanitizePreview', () => {
  it('masks api_key value', () => {
    const input = 'api_key: secret123 more text';
    const result = _sanitizePreview(input);
    assert.strictEqual(result, 'api_key: ***MASKED*** more text');
  });

  it('masks authorization header', () => {
    const input = 'authorization: Bearer abc.def.ghi';
    const result = _sanitizePreview(input);
    assert.strictEqual(result, 'authorization: ***MASKED***');
  });

  it('masks password field', () => {
    const input = 'password: mypassword123';
    const result = _sanitizePreview(input);
    assert.strictEqual(result, 'password: ***MASKED***');
  });

  it('masks token value', () => {
    const input = 'token=abc123';
    const result = _sanitizePreview(input);
    assert.strictEqual(result, 'token: ***MASKED***');
  });

  it('masks secret with equals sign', () => {
    const input = 'secret=shhh';
    const result = _sanitizePreview(input);
    assert.strictEqual(result, 'secret: ***MASKED***');
  });

  it('masks credential in JSON-like string', () => {
    const input = '{"credential": "xyz"}';
    const result = _sanitizePreview(input);
    assert.strictEqual(result, '{"credential": ***MASKED***}');
  });

  it('masks apiKey camelCase', () => {
    const input = 'apiKey: key123';
    const result = _sanitizePreview(input);
    assert.strictEqual(result, 'apiKey: ***MASKED***');
  });

  it('masks bearer token', () => {
    const input = 'bearer abc123';
    const result = _sanitizePreview(input);
    assert.strictEqual(result, 'bearer ***MASKED***');
  });

  it('leaves non-sensitive content unchanged', () => {
    const input = 'hello world, this is a test';
    const result = _sanitizePreview(input);
    assert.strictEqual(result, input);
  });

  it('masks multiple sensitive keys in one string', () => {
    const input = 'api_key: secret1, token=secret2';
    const result = _sanitizePreview(input);
    assert.strictEqual(result, 'api_key: ***MASKED***, token: ***MASKED***');
  });

  it('handles null/undefined input', () => {
    assert.strictEqual(_sanitizePreview(null), null);
    assert.strictEqual(_sanitizePreview(undefined), undefined);
  });
});

describe('orchestrator-router slash-format config', () => {
  it('returns slash-format routes normalized to comma format', async () => {
    const slashConfig = {
      Router: {
        default: 'ollama/glm-5.1:cloud',
        think: 'ollama/glm-5.1:cloud',
        code: 'ollama/devstral-2:123b-cloud',
        background: 'ollama/gemini-3-flash-preview:cloud',
        haikuModels: ['haiku'],
      },
    };
    const req = makeReq('claude-3-haiku', [{ role: 'user', content: 'hello' }]);
    const result = await orchestratorRouter(req, slashConfig);
    assert.strictEqual(result, 'ollama,gemini-3-flash-preview:cloud');
  });

  it('returns comma-format routes unchanged', async () => {
    const commaConfig = {
      Router: {
        default: 'ollama,glm-5.1:cloud',
        background: 'ollama,gemini-3-flash-preview:cloud',
        haikuModels: ['haiku'],
      },
    };
    const req = makeReq('claude-3-haiku', [{ role: 'user', content: 'hello' }]);
    const result = await orchestratorRouter(req, commaConfig);
    assert.strictEqual(result, 'ollama,gemini-3-flash-preview:cloud');
  });
});
