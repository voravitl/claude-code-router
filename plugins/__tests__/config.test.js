const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = '/Users/voravit.l/.claude-code-router/config.json';

describe('config.json validation', () => {
  let config;

  it('parses as valid JSON', () => {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    assert.doesNotThrow(() => { config = JSON.parse(raw); }, 'config.json should be valid JSON');
  });

  it('no duplicate models in Providers[].models', () => {
    if (!config) config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    for (const provider of config.Providers || []) {
      const models = provider.models || [];
      const seen = new Set();
      for (const model of models) {
        assert.ok(!seen.has(model), `duplicate model "${model}" in provider "${provider.name}"`);
        seen.add(model);
      }
    }
  });

  it('all Router values match "provider,model" pattern', () => {
    if (!config) config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const router = config.Router || {};
    const routeKeys = ['default', 'think', 'code', 'codeReview', 'background', 'image', 'longContext'];
    for (const key of routeKeys) {
      if (router[key]) {
        const parts = router[key].split(',');
        assert.ok(parts.length === 2, `Router.${key} = "${router[key]}" should be "provider,model"`);
        assert.ok(parts[0].length > 0, `Router.${key} provider should not be empty`);
        assert.ok(parts[1].length > 0, `Router.${key} model should not be empty`);
      }
    }
  });

  it('all fallback values match "provider,model" pattern', () => {
    if (!config) config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const fallback = config.fallback || {};
    for (const [key, entries] of Object.entries(fallback)) {
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          const parts = entry.split(',');
          assert.ok(parts.length === 2, `fallback.${key} entry "${entry}" should be "provider,model"`);
          assert.ok(parts[0].length > 0, `fallback.${key} provider should not be empty`);
          assert.ok(parts[1].length > 0, `fallback.${key} model should not be empty`);
        }
      }
    }
  });

  it('all transformer paths resolve to existing files', () => {
    if (!config) config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    for (const transformer of config.transformers || []) {
      const tPath = transformer.path;
      assert.ok(tPath, 'transformer should have a path');
      assert.ok(fs.existsSync(tPath), `transformer path "${tPath}" should exist`);
    }
  });

  it('has required top-level keys', () => {
    if (!config) config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    assert.ok(config.Providers, 'should have Providers');
    assert.ok(config.Router, 'should have Router');
    assert.ok(config.transformers, 'should have transformers');
  });

  it('Router has required route keys', () => {
    if (!config) config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const requiredKeys = ['default', 'think', 'code', 'background', 'image'];
    for (const key of requiredKeys) {
      assert.ok(config.Router[key], `Router should have "${key}" route`);
    }
  });
});