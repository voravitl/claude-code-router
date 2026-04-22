#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

// ---- CLI ----
const configPath = process.argv[2] || path.join(__dirname, '..', 'config.json');

// ---- Constants ----
const MIN_NODE_VERSION = 18;
const HEALTH_CHECK_TIMEOUT_MS = 5000;
const DEFAULT_PORT = 3456;

const ICONS = {
  pass: '\u2713',
  fail: '\u2717',
  skip: '\u26A0',
};

// ---- Results ----
const results = [];

function record(status, description) {
  const icon = status === 'pass' ? ICONS.pass : status === 'fail' ? ICONS.fail : ICONS.skip;
  console.log(`${icon} ${status.toUpperCase()} — ${description}`);
  results.push({ status, description });
}

// ---- Checks ----

async function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major >= MIN_NODE_VERSION) {
    record('pass', `Node.js version ${process.versions.node} >= ${MIN_NODE_VERSION}`);
  } else {
    record('fail', `Node.js version ${process.versions.node} < ${MIN_NODE_VERSION}`);
  }
}

function checkConfigValidity() {
  if (!fs.existsSync(configPath)) {
    record('fail', `config.json not found at ${configPath}`);
    return null;
  }

  let config;
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(raw);
  } catch (err) {
    record('fail', `config.json is not valid JSON: ${err.message}`);
    return null;
  }

  const missing = [];
  if (!config.Providers) missing.push('Providers');
  if (!config.Router) missing.push('Router');
  if (!config.transformers) missing.push('transformers');

  if (missing.length > 0) {
    record('fail', `config.json missing required keys: ${missing.join(', ')}`);
  } else {
    record('pass', 'config.json is valid JSON with required keys (Providers, Router, transformers)');
  }

  return config;
}

function checkTransformerPaths(config) {
  if (!config || !config.transformers) return;

  const missing = [];
  for (const transformer of config.transformers) {
    const tPath = transformer.path;
    if (!tPath) {
      missing.push('(missing path)');
      continue;
    }
    if (!fs.existsSync(tPath)) {
      missing.push(tPath);
    }
  }

  if (missing.length > 0) {
    record('fail', `${missing.length} transformer path(s) do not resolve: ${missing.join(', ')}`);
  } else {
    record('pass', `All ${config.transformers.length} transformer paths resolve to existing files`);
  }
}

function checkDuplicateModels(config) {
  if (!config || !config.Providers) return;

  const modelToProviders = new Map();
  for (const provider of config.Providers) {
    for (const model of provider.models || []) {
      if (!modelToProviders.has(model)) {
        modelToProviders.set(model, []);
      }
      modelToProviders.get(model).push(provider.name);
    }
  }

  const duplicates = [];
  for (const [model, providers] of modelToProviders) {
    if (providers.length > 1) {
      duplicates.push(`${model} (${providers.join(', ')})`);
    }
  }

  if (duplicates.length > 0) {
    record('fail', `Duplicate models found across providers: ${duplicates.join('; ')}`);
  } else {
    record('pass', 'No duplicate model names across providers');
  }
}

function checkApiKeys(config) {
  if (!config || !config.Providers) return;

  const issues = [];
  for (const provider of config.Providers) {
    const key = provider.api_key;
    const name = provider.name;

    // "ollama" is a valid local exception
    if (key === 'ollama') continue;

    if (!key || key.trim() === '') {
      issues.push(`${name}: api_key is empty`);
      continue;
    }

    // Check for placeholder $VAR patterns
    if (key.startsWith('$')) {
      const envVar = key.slice(1);
      const envValue = process.env[envVar];
      if (!envValue || envValue.trim() === '') {
        issues.push(`${name}: api_key placeholder "${key}" — env var ${envVar} is not set`);
      }
    }
  }

  if (issues.length > 0) {
    record('fail', `API key issues: ${issues.join('; ')}`);
  } else {
    record('pass', 'All provider API keys are valid (not empty, no unset placeholders)');
  }
}

async function checkProviderReachability(config) {
  if (!config || !config.Providers) return;

  const checks = [];
  for (const provider of config.Providers) {
    const url = provider.api_base_url;
    const name = provider.name;

    if (!url) {
      checks.push({ name, ok: false, reason: 'missing api_base_url' });
      continue;
    }

    // Skip localhost if no server is running
    const isLocalhost = /^(http:\/\/)?(localhost|127\.0\.0\.1)/.test(url);
    if (isLocalhost) {
      try {
        await headRequest(url, HEALTH_CHECK_TIMEOUT_MS);
        checks.push({ name, ok: true, reason: 'localhost reachable' });
      } catch {
        checks.push({ name, ok: true, reason: 'localhost (server not running — skipped)', skipped: true });
      }
      continue;
    }

    try {
      await headRequest(url, HEALTH_CHECK_TIMEOUT_MS);
      checks.push({ name, ok: true, reason: 'reachable' });
    } catch (err) {
      checks.push({ name, ok: false, reason: err.message || 'unreachable' });
    }
  }

  const failed = checks.filter(c => !c.ok && !c.skipped);
  const skipped = checks.filter(c => c.skipped);
  const passed = checks.filter(c => c.ok && !c.skipped);

  if (failed.length > 0) {
    const details = failed.map(c => `${c.name}: ${c.reason}`).join('; ');
    record('fail', `${failed.length} provider(s) unreachable — ${details}`);
  } else if (skipped.length > 0) {
    const details = skipped.map(c => `${c.name}: ${c.reason}`).join('; ');
    record('skip', `${passed.length} reachable, ${skipped.length} skipped — ${details}`);
  } else {
    record('pass', `All ${passed.length} provider(s) reachable`);
  }
}

function headRequest(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.request(url, { method: 'HEAD', timeout: timeoutMs }, (res) => {
      resolve(res);
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.end();
  });
}

function checkPort(config) {
  const port = config?.PORT || DEFAULT_PORT;

  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        record('fail', `Port ${port} is already in use`);
      } else {
        record('fail', `Port ${port} check error: ${err.message}`);
      }
      resolve();
    });
    server.once('listening', () => {
      server.close(() => {
        record('pass', `Port ${port} is available`);
        resolve();
      });
    });
    server.listen(port);
  });
}

// ---- Main ----

async function main() {
  console.log(`CCR Doctor — health check\nConfig: ${configPath}\n`);

  await checkNodeVersion();
  const config = checkConfigValidity();
  checkTransformerPaths(config);
  checkDuplicateModels(config);
  checkApiKeys(config);
  await checkProviderReachability(config);
  await checkPort(config);

  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const skipped = results.filter(r => r.status === 'skip').length;
  const total = results.length;

  console.log(`\n${passed}/${total} checks passed`);
  if (failed > 0) {
    console.log(`${failed} check(s) failed`);
    process.exit(1);
  }
  if (skipped > 0) {
    console.log(`${skipped} check(s) skipped`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
