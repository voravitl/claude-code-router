/**
 * Response Optimizer Transformer (Simplified)
 *
 * Passthrough by default. Opt-in features: metadata, error enhancement.
 * Removed: stream interception, status watermark, content filtering.
 */

const RETRYABLE_TYPES = new Set(['rate_limit_error', 'server_error', 'api_error', 'timeout']);

module.exports = class ResponseOptimizerTransformer {
  constructor(options = {}) {
    this.name = "response-optimizer";
    this.options = {
      enableMetadata: false,
      enableErrorEnhancement: false,
      enableRetry: false,
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 60000,
      ...options,
    };
  }

  async transformResponseOut(response, context) {
    // SAFETY NET: Fix reasoning models that return empty content
    //    Some models (e.g. deepseek-v3.x) put thinking in "reasoning" field
    //    and leave "content" empty. Merge reasoning into content when empty.
    if (response && typeof response === 'object' && !response.headers) {
      // Direct object response (already parsed)
      if (response.choices && Array.isArray(response.choices)) {
        for (const choice of response.choices) {
          const msg = choice.message;
          if (msg && msg.content === '' && msg.reasoning) {
            msg.content = msg.reasoning;
            delete msg.reasoning;
          }
        }
      }
    }

    if (!response || typeof response !== 'object') return response;

    if (this._shouldRetry(response, context)) {
      return this._buildRetryResponse(response, context);
    }

    // FAST PATH: passthrough when nothing else enabled
    if (!this.options.enableMetadata && !this.options.enableErrorEnhancement) {
      return response;
    }

    const contentType = (typeof response.headers?.get === 'function')
      ? response.headers.get('Content-Type') || ''
      : (response.headers?.['Content-Type'] || '');

    // Handle JSON response
    if (contentType.includes('application/json')) {
      try {
        const jsonResponse = typeof response.json === 'function'
          ? await response.json()
          : (response.body ? JSON.parse(response.body) : response);

        // Fix reasoning models: merge reasoning into content if content is empty
        if (jsonResponse.choices && Array.isArray(jsonResponse.choices)) {
          for (const choice of jsonResponse.choices) {
            const msg = choice.message;
            if (msg && msg.content === '' && msg.reasoning) {
              msg.content = msg.reasoning;
              delete msg.reasoning;
            }
          }
        }

        if (this.options.enableMetadata && context?.requestInfo) {
          jsonResponse._metadata = {
            timestamp: Date.now(),
            optimized: true,
            transformer: this.name,
          };
        }

        if (jsonResponse.error && this.options.enableErrorEnhancement) {
          jsonResponse.error = this.enhanceErrorResponse(jsonResponse.error);
        }

        return jsonResponse;
      } catch (_) {
        return response;
      }
    }

    return response;
  }

  enhanceErrorResponse(errorObj) {
    const error = errorObj || {};
    return {
      ...error,
      timestamp: Date.now(),
      context: {
        errorType: error.type || 'unknown',
        errorCode: error.code || 'unknown',
        isRetryable: RETRYABLE_TYPES.has(error.type),
        suggestedAction: this.getSuggestedAction(error),
      },
    };
  }

  getSuggestedAction(error) {
    if (error?.type === 'rate_limit_error') return 'retry_after_delay';
    if (error?.type === 'invalid_request_error') return 'fix_request';
    if (error?.type === 'authentication_error') return 'check_credentials';
    if (error?.type === 'server_error') return 'retry_with_backoff';
    return 'investigate';
  }

  _calculateBackoff(attempt) {
    const base = this.options.baseDelayMs || 1000;
    const cap = this.options.maxDelayMs || 60000;
    const temp = Math.min(cap, base * Math.pow(2, attempt));
    const jitter = temp * Math.random();
    return Math.min(cap, jitter);
  }

  _parseRetryAfter(headers) {
    if (!headers) return null;
    const retryAfter = headers['retry-after'] || headers.get?.('retry-after');
    if (!retryAfter) return null;
    const seconds = parseInt(retryAfter, 10);
    return isNaN(seconds) ? null : seconds * 1000;
  }

  _shouldRetry(response, context) {
    if (!this.options.enableRetry) return false;
    const attempt = context?.retryAttempt || 0;
    if (attempt >= this.options.maxRetries) return false;

    const status = response?.status || response?.headers?.status;
    if (status === 429 || status === 503) return true;

    if (response?.error && RETRYABLE_TYPES.has(response.error.type)) {
      return true;
    }

    return false;
  }

  _buildRetryResponse(response, context) {
    const attempt = context?.retryAttempt || 0;
    const retryAfter = this._parseRetryAfter(response.headers);
    const delay = retryAfter || this._calculateBackoff(attempt);
    return { ...response, _retry: { delay, attempt: attempt + 1 } };
  }
};