const { describe, it } = require('node:test');
const assert = require('node:assert');
const orchestratorRouter = require('../orchestrator-router.js');
const SmartOptimizerTransformer = require('../smart-optimizer.transformer.js');
const AuthForwarderTransformer = require('../auth-forwarder.transformer.js');
const ResponseOptimizerTransformer = require('../response-optimizer.transformer.js');
const config = require('/Users/voravit.l/.claude-code-router/config.json');

async function runPipeline(reqBody, providerConfig) {
  const req = { body: reqBody, log: { info: () => {} } };
  providerConfig = providerConfig || { apiKey: 'test-key' };

  // 1. Route
  const route = await orchestratorRouter(req, config);

  // 2. Smart optimizer
  const optimizer = new SmartOptimizerTransformer({ enableLLMOptimization: false });
  const optimizedBody = await optimizer.transformRequestIn({ ...reqBody }, providerConfig, {});

  // 3. Auth
  const auth = new AuthForwarderTransformer();
  const authResult = await auth.auth(optimizedBody, providerConfig);

  // 4. Response optimizer
  const responseOptimizer = new ResponseOptimizerTransformer();
  const mockResponse = {
    choices: [{ message: { content: 'result', role: 'assistant' } }],
  };
  const processedResponse = await responseOptimizer.transformResponseOut(mockResponse, {});

  return { route, optimizedBody: authResult.body, headers: authResult.config.headers, response: processedResponse };
}

describe('Integration: full pipeline', () => {
  it('Thai debug request → code route, CoT in output, reasoning_effort preserved', async () => {
    const result = await runPipeline({
      model: 'devstral-2:123b-cloud',
      messages: [{ role: 'user', content: 'แก้บั๊ก API ไม่ทำงาน' }],
    });

    // Route should be code
    assert.strictEqual(result.route, config.Router.code);

    // CoT should appear in structured output
    const userMessages = result.optimizedBody.messages.filter(m => m.role === 'user');
    const userContent = userMessages[userMessages.length - 1];
    const content = typeof userContent.content === 'string' ? userContent.content : JSON.stringify(userContent.content);
    assert.ok(content.includes('<thinking>'), 'should include CoT thinking tags');
    assert.ok(content.includes('<ccr-role>'), 'should include role prompt');

    // reasoning_effort should be set
    assert.strictEqual(result.optimizedBody.reasoning_effort, 'none');
  });

  it('Image request → image route', async () => {
    const result = await runPipeline({
      model: 'gemini-3-flash',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'describe this image' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
        ],
      }],
    });

    assert.strictEqual(result.route, config.Router.image);
  });

  it('Simple query → background route for haiku model', async () => {
    const result = await runPipeline({
      model: 'claude-3-haiku',
      messages: [{ role: 'user', content: 'what is closure' }],
    });

    assert.strictEqual(result.route, config.Router.background);
  });

  it('Response optimizer merges empty content with reasoning', async () => {
    const ro = new ResponseOptimizerTransformer();
    const response = {
      choices: [{ message: { content: '', reasoning: 'I thought about it', role: 'assistant' } }],
    };
    const result = await ro.transformResponseOut(response, {});
    assert.strictEqual(result.choices[0].message.content, 'I thought about it');
  });

  it('Auth uses x-api-key for Anthropic provider', async () => {
    const savedKey = process.env.ANTHROPIC_KEY;
    delete process.env.ANTHROPIC_KEY;
    const auth = new AuthForwarderTransformer();
    const result = await auth.auth({ model: 'claude-sonnet-4-6' }, { name: 'anthropic', apiKey: 'sk-ant-test' });
    assert.strictEqual(result.config.headers['x-api-key'], 'sk-ant-test');
    assert.strictEqual(result.config.headers['anthropic-version'], '2023-06-01');
    if (savedKey !== undefined) process.env.ANTHROPIC_KEY = savedKey;
  });

  it('Auth uses x-api-key for Ollama provider', async () => {
    const auth = new AuthForwarderTransformer();
    const result = await auth.auth({ model: 'test' }, { name: 'ollama', apiKey: 'ollama' });
    assert.strictEqual(result.config.headers['x-api-key'], 'ollama');
  });

  it('Pipeline preserves body model through all stages', async () => {
    const result = await runPipeline({
      model: 'devstral-2:123b-cloud',
      messages: [{ role: 'user', content: 'implement sort' }],
    });
    assert.strictEqual(result.optimizedBody.model, 'devstral-2:123b-cloud');
  });
});