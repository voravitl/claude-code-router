type Provider = {
  name: string;
  api_base_url: string;
  api_key: string;
  models: string[];
};

export interface ProviderHealth {
  name: string;
  status: "online" | "offline" | "slow";
  latencyMs: number;
  lastChecked: string;
  models: string[];
}

const healthStore = new Map<string, ProviderHealth>();
let healthCheckInterval: NodeJS.Timeout | null = null;

const HEALTH_CHECK_TIMEOUT_MS = 5000;
const HEALTH_CHECK_INTERVAL_MS = 30000;
const SLOW_THRESHOLD_MS = 3000;

async function checkSingleProvider(provider: Provider): Promise<ProviderHealth> {
  const start = Date.now();
  let status: ProviderHealth["status"] = "offline";
  let latencyMs = 0;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

    const url = provider.api_base_url;
    // Try a simple GET to the base URL; most providers respond with some info
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${provider.api_key || ""}`,
      },
    });

    clearTimeout(timeout);
    latencyMs = Date.now() - start;

    if (response.ok || response.status === 401 || response.status === 404) {
      // 401/404 means the endpoint exists but needs auth or path is wrong — provider is up
      status = latencyMs > SLOW_THRESHOLD_MS ? "slow" : "online";
    } else {
      status = "offline";
    }
  } catch (error: any) {
    latencyMs = Date.now() - start;
    status = "offline";
  }

  return {
    name: provider.name,
    status,
    latencyMs,
    lastChecked: new Date().toISOString(),
    models: provider.models || [],
  };
}

export async function checkProvider(provider: Provider): Promise<ProviderHealth> {
  const health = await checkSingleProvider(provider);
  healthStore.set(provider.name, health);
  return health;
}

export function getProviderHealth(): ProviderHealth[] {
  return Array.from(healthStore.values());
}

export function startHealthChecks(providers: Provider[]): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }

  // Run immediately once
  for (const provider of providers) {
    checkProvider(provider).catch((err) =>
      console.error(`Health check failed for ${provider.name}:`, err)
    );
  }

  healthCheckInterval = setInterval(() => {
    for (const provider of providers) {
      checkProvider(provider).catch((err) =>
        console.error(`Health check failed for ${provider.name}:`, err)
      );
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

export function stopHealthChecks(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}
