/**
 * Circuit Breaker Transformer (v2 — per-scope, Retry-After, probe lock)
 * Tracks 429/503 per provider+model scope. After N consecutive failures: open circuit.
 * Half-open: after cooldown, one probe request. If success: close circuit. If failure: reopen.
 * Honors Retry-After headers. Probe lock prevents concurrent slip-through.
 *
 * Config:
 *   enabled: true
 *   failureThreshold: 3       // failures before opening circuit
 *   cooldownMs: 30000          // 30s default cooldown
 *   halfOpenMaxRequests: 1     // requests allowed in half-open state
 */
class CircuitBreakerTransformer {
  constructor(options = {}) {
    this.name = "circuit-breaker";
    this.options = {
      enabled: true,
      failureThreshold: 3,
      cooldownMs: 30000,
      halfOpenMaxRequests: 1,
      ...options,
    };
    // Per-scope circuit state: provider:model -> { failures, state, openedUntil, probeInFlight }
    this._circuits = new Map();
  }

  _getScopeKey(providerName, modelName) {
    return `${providerName || ''}:${modelName || ''}`;
  }

  _getCircuit(scopeKey) {
    if (!this._circuits.has(scopeKey)) {
      this._circuits.set(scopeKey, {
        failures: 0,
        state: 'closed',
        openedUntil: 0,
        probeInFlight: false,
      });
    }
    return this._circuits.get(scopeKey);
  }

  _getCircuitState(scopeKey) {
    const circuit = this._getCircuit(scopeKey);

    if (circuit.state === 'open') {
      if (Date.now() >= circuit.openedUntil) {
        circuit.state = 'half-open';
        circuit.probeInFlight = false;
      }
    }

    return circuit.state;
  }

  _parseRetryAfter(headers) {
    if (!headers) return null;
    // Support both Headers objects and plain objects
    const retryAfter = typeof headers.get === 'function'
      ? headers.get('retry-after')
      : (headers['retry-after'] || headers['Retry-After']);
    if (!retryAfter) return null;
    const seconds = parseInt(retryAfter, 10);
    return isNaN(seconds) ? null : seconds * 1000;
  }

  async transformRequestIn(request, provider, context) {
    if (!this.options.enabled) return request;

    const providerName = typeof provider === 'string' ? provider : provider?.name || '';
    const modelName = request?.model || '';
    const scopeKey = this._getScopeKey(providerName, modelName);

    // Store scope key for response handler
    if (context) context._circuitScopeKey = scopeKey;

    const state = this._getCircuitState(scopeKey);

    if (state === 'open') {
      const circuit = this._getCircuit(scopeKey);
      const error = new Error(`Circuit breaker open for ${scopeKey}. Retry after cooldown.`);
      error.code = 'CIRCUIT_OPEN';
      error.provider = providerName;
      error.retryAfter = Math.max(0, circuit.openedUntil - Date.now());
      throw error;
    }

    if (state === 'half-open') {
      const circuit = this._getCircuit(scopeKey);
      if (circuit.probeInFlight) {
        const error = new Error(`Circuit breaker half-open for ${scopeKey}. Probe already in flight.`);
        error.code = 'CIRCUIT_HALF_OPEN';
        error.provider = providerName;
        throw error;
      }
      circuit.probeInFlight = true;
    }

    return request;
  }

  async transformResponseOut(response, context) {
    if (!this.options.enabled) return response;

    const scopeKey = context?._circuitScopeKey || context?.provider?.name || context?.provider || '';
    const circuit = this._getCircuit(scopeKey);

    const status = response?.status || response?.statusCode || 0;

    if (status === 429 || status === 503) {
      circuit.failures++;
      if (circuit.failures >= this.options.failureThreshold) {
        circuit.state = 'open';
        // Honor Retry-After header if present
        const retryAfterMs = this._parseRetryAfter(response?.headers || context?.responseHeaders);
        const cooldownMs = retryAfterMs && retryAfterMs > this.options.cooldownMs
          ? retryAfterMs
          : this.options.cooldownMs;
        circuit.openedUntil = Date.now() + cooldownMs;
      }
      circuit.probeInFlight = false;
    } else if (status >= 200 && status < 300) {
      // Success — close circuit
      circuit.failures = 0;
      circuit.state = 'closed';
      circuit.probeInFlight = false;
    }

    return response;
  }
}

module.exports = CircuitBreakerTransformer;