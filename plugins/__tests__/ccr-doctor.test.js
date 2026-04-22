const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const DOCTOR_PATH = path.join(__dirname, '..', 'ccr-doctor.js');

function runDoctor(configPath) {
  return new Promise((resolve, reject) => {
    const args = configPath ? [DOCTOR_PATH, configPath] : [DOCTOR_PATH];
    const proc = require('node:child_process').fork(args[0], args.slice(1), {
      silent: true,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d; });
    proc.stderr?.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    proc.on('error', reject);
  });
}

describe('ccr-doctor', () => {
  const tmpDir = path.join(__dirname, '.tmp-doctor-test');
  const goodConfigPath = path.join(tmpDir, 'good-config.json');
  const badJsonPath = path.join(tmpDir, 'bad-json.json');
  const missingKeysPath = path.join(tmpDir, 'missing-keys.json');
  const dupModelsPath = path.join(tmpDir, 'dup-models.json');
  const badKeysPath = path.join(tmpDir, 'bad-keys.json');

  before(() => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    fs.writeFileSync(goodConfigPath, JSON.stringify({
      PORT: 9999,
      API_TIMEOUT_MS: 30000,
      Providers: [
        {
          name: 'test-provider',
          api_base_url: 'http://localhost:99999/v1',
          api_key: 'test-key',
          models: ['model-a', 'model-b'],
        },
      ],
      Router: { default: 'test-provider,model-a' },
      transformers: [],
    }, null, 2));

    fs.writeFileSync(badJsonPath, '{ invalid json }');

    fs.writeFileSync(missingKeysPath, JSON.stringify({
      Providers: [],
    }, null, 2));

    fs.writeFileSync(dupModelsPath, JSON.stringify({
      Providers: [
        {
          name: 'p1',
          api_base_url: 'http://localhost:99999/v1',
          api_key: 'k1',
          models: ['dup-model', 'unique-a'],
        },
        {
          name: 'p2',
          api_base_url: 'http://localhost:99998/v1',
          api_key: 'k2',
          models: ['dup-model', 'unique-b'],
        },
      ],
      Router: { default: 'p1,dup-model' },
      transformers: [],
    }, null, 2));

    fs.writeFileSync(badKeysPath, JSON.stringify({
      Providers: [
        {
          name: 'empty-key',
          api_base_url: 'http://localhost:99999/v1',
          api_key: '',
          models: ['m1'],
        },
        {
          name: 'placeholder-key',
          api_base_url: 'http://localhost:99998/v1',
          api_key: '$MISSING_ENV_VAR',
          models: ['m2'],
        },
        {
          name: 'ollama-ok',
          api_base_url: 'http://localhost:11434/v1/chat/completions',
          api_key: 'ollama',
          models: ['m3'],
        },
      ],
      Router: { default: 'empty-key,m1' },
      transformers: [],
    }, null, 2));
  });

  it('passes with valid config', async () => {
    const { code, stdout } = await runDoctor(goodConfigPath);
    assert.ok(stdout.includes('PASS'), stdout);
    assert.ok(stdout.includes('config.json is valid JSON'), stdout);
    assert.strictEqual(code, 0);
  });

  it('fails with invalid JSON', async () => {
    const { code, stdout } = await runDoctor(badJsonPath);
    assert.ok(stdout.includes('FAIL'), stdout);
    assert.ok(stdout.includes('not valid JSON'), stdout);
    assert.strictEqual(code, 1);
  });

  it('fails with missing required keys', async () => {
    const { code, stdout } = await runDoctor(missingKeysPath);
    assert.ok(stdout.includes('FAIL'), stdout);
    assert.ok(stdout.includes('missing required keys'), stdout);
    assert.strictEqual(code, 1);
  });

  it('detects duplicate models across providers', async () => {
    const { code, stdout } = await runDoctor(dupModelsPath);
    assert.ok(stdout.includes('FAIL'), stdout);
    assert.ok(stdout.includes('Duplicate models'), stdout);
    assert.ok(stdout.includes('dup-model'), stdout);
    assert.strictEqual(code, 1);
  });

  it('validates API keys (empty, placeholder, ollama exception)', async () => {
    const { code, stdout } = await runDoctor(badKeysPath);
    assert.ok(stdout.includes('FAIL'), stdout);
    assert.ok(stdout.includes('empty-key: api_key is empty'), stdout);
    assert.ok(stdout.includes('placeholder-key'), stdout);
    assert.ok(stdout.includes('MISSING_ENV_VAR'), stdout);
    assert.strictEqual(code, 1);
  });

  it('allows ollama as valid api_key exception', async () => {
    const ollamaOnlyPath = path.join(tmpDir, 'ollama-only.json');
    fs.writeFileSync(ollamaOnlyPath, JSON.stringify({
      Providers: [
        {
          name: 'ollama',
          api_base_url: 'http://localhost:11434/v1/chat/completions',
          api_key: 'ollama',
          models: ['m1'],
        },
      ],
      Router: { default: 'ollama,m1' },
      transformers: [],
    }, null, 2));
    const { code, stdout } = await runDoctor(ollamaOnlyPath);
    assert.ok(stdout.includes('PASS'), stdout);
    assert.ok(!stdout.includes('ollama-ok: api_key'), stdout);
    assert.strictEqual(code, 0);
  });

  it('mocks provider reachability check', async () => {
    // Start a tiny HTTP server to act as a reachable provider
    const server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const reachableConfigPath = path.join(tmpDir, 'reachable.json');
    fs.writeFileSync(reachableConfigPath, JSON.stringify({
      PORT: 9999,
      Providers: [
        {
          name: 'reachable',
          api_base_url: `http://127.0.0.1:${port}/`,
          api_key: 'k',
          models: ['m1'],
        },
      ],
      Router: { default: 'reachable,m1' },
      transformers: [],
    }, null, 2));

    const { code, stdout } = await runDoctor(reachableConfigPath);
    server.close();

    assert.ok(stdout.includes('PASS'), stdout);
    assert.ok(stdout.includes('reachable') || stdout.includes('provider(s)'), stdout);
    assert.strictEqual(code, 0);
  });
});
