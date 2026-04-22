/**
 * Auth Forwarder Transformer
 * Handles authentication for different providers:
 * - Anthropic: reads ANTHROPIC_KEY from .env or env var, fallback to config api_key
 * - Gemini: tries OAuth (gcloud CLI → ADC → env var → config api_key)
 * - Ollama: uses api_key from config (defaults to "ollama")
 * - Other providers: uses api_key from config
 *
 * CCR calls auth(body, providerConfig) with only 2 args — no context.
 * CCR builds default headers: {Authorization: Bearer ${apiKey}, ...authHeaders}
 * Auth headers OVERWRITE defaults, so we override Authorization for Anthropic.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Load .env file once at module load
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

module.exports = class AuthForwarderTransformer {
  constructor(options = {}) {
    this.name = "AuthForwarder";
    this.options = options;
    this.enableCredentialCache = options.enableCredentialCache !== false;
    this.credentialCacheTtlMs = options.credentialCacheTtlMs || 58 * 60 * 1000;
    this._credentialCache = new Map(); // key: "provider:authSource" -> { token, expiresAt }
  }

  async auth(requestBody, provider) {
    const apiKey = provider?.apiKey || provider?.api_key;
    const providerName = (provider?.name || '').toLowerCase();

    if (providerName === 'anthropic') {
      // Anthropic: prefer ANTHROPIC_KEY env var, fallback to config api_key
      const anthropicKey = process.env.ANTHROPIC_KEY || apiKey;
      return {
        body: requestBody,
        config: {
          headers: {
            // Override CCR's default "Authorization: Bearer <apiKey>" with real key
            "Authorization": `Bearer ${anthropicKey}`,
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
          },
        },
      };
    }

    if (providerName === 'gemini' || providerName === 'gemini-oauth') {
      const token = await this._resolveGeminiTokenCached(apiKey, providerName);
      const isOAuthToken = typeof token === 'string' && token.startsWith('ya29.');
      return {
        body: requestBody,
        config: {
          headers: isOAuthToken
            ? { "Authorization": `Bearer ${token}` }
            : { "x-goog-api-key": token },
        },
      };
    }

    // Ollama and other providers: use x-api-key from config
    return {
      body: requestBody,
      config: {
        headers: {
          "x-api-key": apiKey || "ollama",
        },
      },
    };
  }

  /**
   * Resolve Gemini token via OAuth priority chain:
   * 1. gcloud CLI: `gcloud auth print-access-token`
   * 2. Application Default Credentials (ADC) refresh
   * 3. GEMINI_API_KEY env var
   * 4. Config api_key
   */
  async _resolveGeminiToken(apiKey) {
    // 1. Try gcloud CLI
    try {
      const token = execSync('gcloud auth print-access-token', {
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      if (token) return token;
    } catch {
      // gcloud not available or not authenticated
    }

    // 2. Try Application Default Credentials (ADC)
    try {
      const adcPath = path.join(
        process.env.HOME || process.env.USERPROFILE || '',
        '.config/gcloud/application_default_credentials.json'
      );
      if (fs.existsSync(adcPath)) {
        const adc = JSON.parse(fs.readFileSync(adcPath, 'utf8'));
        if (adc.type === 'authorized_user' && adc.refresh_token) {
          const token = await this._refreshGoogleToken(
            adc.client_id,
            adc.client_secret,
            adc.refresh_token
          );
          if (token) return token;
        }
      }
    } catch {
      // ADC not available or invalid
    }

    // 3. Try GEMINI_API_KEY env var
    if (process.env.GEMINI_API_KEY) {
      return process.env.GEMINI_API_KEY;
    }

    // 4. Fallback to config api_key
    return apiKey || '';
  }

  _getCacheKey(providerName, authSource) {
    return `${providerName}:${authSource}`;
  }

  /**
   * Resolve Gemini token with caching. Returns cached token if valid,
   * otherwise resolves fresh token and caches it.
   */
  async _resolveGeminiTokenCached(apiKey, providerName) {
    const cacheKey = this._getCacheKey(providerName, 'oauth');
    const cached = this._credentialCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    // Cache miss or expired - resolve fresh token
    const token = await this._resolveGeminiToken(apiKey);

    // Cache with configured TTL (default 58 minutes, tokens last 60 min)
    // Never cache refresh tokens
    if (this.enableCredentialCache) {
      this._credentialCache.set(cacheKey, {
        token,
        expiresAt: Date.now() + this.credentialCacheTtlMs,
      });
    }

    return token;
  }

  /**
   * Invalidate cached credentials for a provider. Call on 401 response.
   */
  invalidateCache(providerName, authSource = 'oauth') {
    const cacheKey = this._getCacheKey(providerName, authSource);
    this._credentialCache.delete(cacheKey);
  }

  /**
   * Response hook: invalidate cache on 401 responses.
   */
  async response(responseBody, provider) {
    const providerName = (provider?.name || '').toLowerCase();
    const status = responseBody?.status || responseBody?.statusCode;

    if (status === 401 && (providerName === 'gemini' || providerName === 'gemini-oauth')) {
      this.invalidateCache(providerName, 'oauth');
    }

    return { body: responseBody };
  }

  /**
   * Refresh Google access token using refresh token via OAuth2 token endpoint.
   */
  _refreshGoogleToken(clientId, clientSecret, refreshToken) {
    return new Promise((resolve) => {
      const https = require('https');
      const postData = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString();

      const req = https.request(
        {
          hostname: 'oauth2.googleapis.com',
          port: 443,
          path: '/token',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
          },
          timeout: 10000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              resolve(json.access_token || null);
            } catch {
              resolve(null);
            }
          });
        }
      );

      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.write(postData);
      req.end();
    });
  }
};
