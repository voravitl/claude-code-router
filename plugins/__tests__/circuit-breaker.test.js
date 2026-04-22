const { describe, it } = require('node:test');
const assert = require('node:assert');
const CircuitBreakerTransformer = require('../circuit-breaker.transformer.js');

describe('CircuitBreakerTransformer', () => {
  describe('constructor', () => {
    it('defaults options correctly', () => {
      const cb = new CircuitBreakerTransformer();
      assert.strictEqual(cb.options.enabled, true);
      assert.strictEqual(cb.options.failureThreshold, 3);
      assert.strictEqual(cb.options.cooldownMs, 30000);
      assert.strictEqual(cb.options.halfOpenMaxRequests, 1);
    });

    it('accepts custom options', () => {
      const cb = new CircuitBreakerTransformer({ failureThreshold: 5, cooldownMs: 10000 });
      assert.strictEqual(cb.options.failureThreshold, 5);
      assert.strictEqual(cb.options.cooldownMs, 10000);
    });
  });

  describe('transformRequestIn — closed circuit', () => {
    it('passes through requests when circuit is closed', async () => {
      const cb = new CircuitBreakerTransformer();
      const request = { model: 'test', messages: [] };
      const result = await cb.transformRequestIn(request, 'ollama', {});
      assert.deepStrictEqual(result, request);
    });

    it('creates circuit per provider on first request', async () => {
      const cb = new CircuitBreakerTransformer();
      const ctx = {};
      await cb.transformRequestIn({ model: 'test' }, 'provider-a', ctx);
      const scopeKey = cb._getScopeKey('provider-a', 'test');
      const circuit = cb._getCircuit(scopeKey);
      assert.strictEqual(circuit.state, 'closed');
      assert.strictEqual(circuit.failures, 0);
    });
  });

  describe('circuit open after failures', () => {
    it('opens circuit after threshold failures', async () => {
      const cb = new CircuitBreakerTransformer({ failureThreshold: 3, cooldownMs: 60000 });
      const ctx = { _circuitScopeKey: 'ollama:' };

      // 3 failures
      await cb.transformResponseOut({ status: 429 }, ctx);
      await cb.transformResponseOut({ status: 429 }, ctx);
      await cb.transformResponseOut({ status: 429 }, ctx);

      const circuit = cb._getCircuit('ollama:');
      assert.strictEqual(circuit.state, 'open');
      assert.ok(circuit.openedUntil > 0);
    });

    it('rejects requests when circuit is open', async () => {
      const cb = new CircuitBreakerTransformer({ failureThreshold: 1, cooldownMs: 60000 });

      // Open circuit via request→response flow
      const ctx = {};
      await cb.transformRequestIn({ model: 'test' }, 'ollama', ctx);
      await cb.transformResponseOut({ status: 429 }, ctx);

      try {
        await cb.transformRequestIn({ model: 'test' }, 'ollama', {});
        assert.fail('Should have thrown');
      } catch (err) {
        assert.strictEqual(err.code, 'CIRCUIT_OPEN');
        assert.ok(err.retryAfter > 0);
      }
    });
  });

  describe('half-open state', () => {
    it('transitions to half-open after cooldown', async () => {
      const cb = new CircuitBreakerTransformer({ failureThreshold: 1, cooldownMs: 0 });
      const scopeKey = 'ollama:';

      // Open circuit
      await cb.transformResponseOut({ status: 429 }, { _circuitScopeKey: scopeKey });
      assert.strictEqual(cb._getCircuit(scopeKey).state, 'open');

      // Immediately check (cooldownMs=0 means it should be half-open)
      const state = cb._getCircuitState(scopeKey);
      assert.strictEqual(state, 'half-open');
    });

    it('closes circuit on half-open success', async () => {
      const cb = new CircuitBreakerTransformer({ failureThreshold: 1, cooldownMs: 0 });
      const scopeKey = 'ollama:';

      // Open circuit
      await cb.transformResponseOut({ status: 429 }, { _circuitScopeKey: scopeKey });

      // Go to half-open
      cb._getCircuitState(scopeKey);

      // Success response closes circuit
      await cb.transformResponseOut({ status: 200 }, { _circuitScopeKey: scopeKey });
      assert.strictEqual(cb._getCircuit(scopeKey).state, 'closed');
      assert.strictEqual(cb._getCircuit(scopeKey).failures, 0);
    });

    it('reopens circuit on half-open failure', async () => {
      const cb = new CircuitBreakerTransformer({ failureThreshold: 1, cooldownMs: 0 });
      const scopeKey = 'ollama:';

      // Open circuit
      await cb.transformResponseOut({ status: 429 }, { _circuitScopeKey: scopeKey });

      // Go to half-open
      cb._getCircuitState(scopeKey);

      // Another failure reopens circuit
      await cb.transformResponseOut({ status: 429 }, { _circuitScopeKey: scopeKey });
      assert.strictEqual(cb._getCircuit(scopeKey).state, 'open');
    });

    it('limits half-open requests to one probe', async () => {
      const cb = new CircuitBreakerTransformer({ failureThreshold: 1, cooldownMs: 0, halfOpenMaxRequests: 1 });

      // Open circuit via request→response flow
      const ctx = {};
      await cb.transformRequestIn({ model: 'test' }, 'ollama', ctx);
      await cb.transformResponseOut({ status: 429 }, ctx);

      // Transition to half-open
      const scopeKey = cb._getScopeKey('ollama', 'test');
      cb._getCircuitState(scopeKey);

      // First request should pass (probe)
      await cb.transformRequestIn({ model: 'test' }, 'ollama', {});

      // Second request should fail (probe already in flight)
      try {
        await cb.transformRequestIn({ model: 'test' }, 'ollama', {});
        assert.fail('Should have thrown');
      } catch (err) {
        assert.strictEqual(err.code, 'CIRCUIT_HALF_OPEN');
      }
    });
  });

  describe('disabled passthrough', () => {
    it('passes through all requests when disabled', async () => {
      const cb = new CircuitBreakerTransformer({ enabled: false });
      const request = { model: 'test' };

      // Should not throw even after failures
      await cb.transformResponseOut({ status: 429 }, { provider: { name: 'ollama' } });
      await cb.transformResponseOut({ status: 429 }, { provider: { name: 'ollama' } });
      await cb.transformResponseOut({ status: 429 }, { provider: { name: 'ollama' } });

      const result = await cb.transformRequestIn(request, 'ollama', {});
      assert.deepStrictEqual(result, request);
    });
  });

  describe('per-provider isolation', () => {
    it('isolates circuits by provider+model scope', async () => {
      const cb = new CircuitBreakerTransformer({ failureThreshold: 1 });

      // Open circuit for provider-a via request→response flow
      const ctxA = {};
      await cb.transformRequestIn({ model: 'test' }, 'provider-a', ctxA);
      await cb.transformResponseOut({ status: 429 }, ctxA);

      // provider-b should still be closed
      const result = await cb.transformRequestIn({ model: 'test' }, 'provider-b', {});
      assert.deepStrictEqual(result, { model: 'test' });

      // provider-a should be rejected
      try {
        await cb.transformRequestIn({ model: 'test' }, 'provider-a', {});
        assert.fail('Should have thrown');
      } catch (err) {
        assert.strictEqual(err.code, 'CIRCUIT_OPEN');
      }
    });

    it('handles string provider vs object provider', async () => {
      const cb = new CircuitBreakerTransformer();

      // String provider
      await cb.transformRequestIn({ model: 'test' }, 'string-provider', {});

      // Object provider with name
      await cb.transformRequestIn({ model: 'test' }, { name: 'object-provider' }, {});

      assert.strictEqual(cb._getCircuit(cb._getScopeKey('string-provider', 'test')).state, 'closed');
      assert.strictEqual(cb._getCircuit(cb._getScopeKey('object-provider', 'test')).state, 'closed');
    });
  });

  describe('503 handling', () => {
    it('counts 503 as failure', async () => {
      const cb = new CircuitBreakerTransformer({ failureThreshold: 1 });
      const scopeKey = 'ollama:';

      await cb.transformResponseOut({ status: 503 }, { _circuitScopeKey: scopeKey });
      assert.strictEqual(cb._getCircuit(scopeKey).state, 'open');
    });
  });

  describe('statusCode fallback', () => {
    it('reads statusCode when status is not present', async () => {
      const cb = new CircuitBreakerTransformer({ failureThreshold: 1 });
      const scopeKey = 'ollama:';

      await cb.transformResponseOut({ statusCode: 429 }, { _circuitScopeKey: scopeKey });
      assert.strictEqual(cb._getCircuit(scopeKey).state, 'open');
    });
  });
});