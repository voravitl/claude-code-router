import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfig } from "@/components/ConfigProvider";
import { countAssignedRoutes, countFallbackCoverage, countModels } from "@/lib/config";
import {
  Activity,
  FileCode2,
  FileJson,
  FileText,
  Layers3,
  PlugZap,
  Route,
  Settings2,
} from "lucide-react";
import type { ProviderTransformer } from "@/types";

interface ConfigOverviewProps {
  onOpenSettings: () => void;
  onOpenJsonEditor: () => void;
  onOpenLogViewer: () => void;
  onOpenPresets: () => void;
}

function MetricTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-3xl border border-white/70 bg-white/90 p-4 shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">{label}</span>
        <Icon className="h-4 w-4 text-slate-500" />
      </div>
      <div className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{value}</div>
      <p className="mt-2 text-sm text-slate-600">{hint}</p>
    </div>
  );
}

function formatTransformerEntry(entry: ProviderTransformer["use"][number]) {
  if (typeof entry === "string") {
    return entry;
  }

  const head = entry[0];
  return typeof head === "string" ? head : "custom";
}

export function ConfigOverview({
  onOpenSettings,
  onOpenJsonEditor,
  onOpenLogViewer,
  onOpenPresets,
}: ConfigOverviewProps) {
  const { config } = useConfig();

  if (!config) {
    return null;
  }

  const routeCount = countAssignedRoutes(config);
  const fallbackCoverage = countFallbackCoverage(config);
  const providerCount = config.Providers.length;
  const transformerCount = config.transformers.length;
  const modelCount = countModels(config);
  const totalTierCount = 8;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-white/70 bg-white/85 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur">
        <CardHeader className="border-b border-slate-200/80 bg-[linear-gradient(135deg,rgba(15,23,42,0.05),rgba(15,23,42,0))]">
          <CardTitle className="flex items-center gap-2 text-xl text-slate-950">
            <Route className="h-5 w-5 text-slate-700" />
            Control plane summary
          </CardTitle>
          <CardDescription className="max-w-xl text-sm text-slate-600">
            Manifest-style overview for routing health, provider inventory, and operational readiness.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 md:grid-cols-2">
          <MetricTile
            icon={Layers3}
            label="Tier coverage"
            value={`${routeCount}/${totalTierCount}`}
            hint="How many routing lanes already have a primary model assigned."
          />
          <MetricTile
            icon={PlugZap}
            label="Providers"
            value={`${providerCount}`}
            hint={`${modelCount} models registered across connected providers.`}
          />
          <MetricTile
            icon={Activity}
            label="Fallback lanes"
            value={`${fallbackCoverage}/${totalTierCount}`}
            hint="How many tiers already have at least one automatic fallback."
          />
          <MetricTile
            icon={FileCode2}
            label="Transformers"
            value={`${transformerCount}`}
            hint="Custom request and response middleware loaded from local plugins."
          />
        </CardContent>
      </Card>

      <Card className="border-white/70 bg-white/80 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg text-slate-950">Provider inventory</CardTitle>
          <CardDescription className="text-sm text-slate-600">
            Quick scan of your current upstreams and how much model surface each one exposes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {config.Providers.length > 0 ? (
            config.Providers.map((provider) => (
              <div
                key={provider.name}
                className="rounded-3xl border border-slate-200/80 bg-slate-50/70 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-950">{provider.name}</div>
                    <div className="mt-1 text-xs text-slate-600">{provider.api_base_url}</div>
                  </div>
                  <Badge
                    variant="outline"
                    className="rounded-full border-slate-300 bg-white/80 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-600"
                  >
                    {provider.models.length} models
                  </Badge>
                </div>
                {provider.transformer?.use?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {provider.transformer.use.map((entry, index) => (
                      <Badge
                        key={`${provider.name}-transformer-${index}`}
                        variant="outline"
                        className="rounded-full border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700"
                      >
                        {formatTransformerEntry(entry)}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-sm text-slate-600">
              No providers configured yet. Add at least one provider to make routing assignable.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-white/70 bg-white/80 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg text-slate-950">
            <Settings2 className="h-5 w-5 text-slate-700" />
            Operations and tools
          </CardTitle>
          <CardDescription className="text-sm text-slate-600">
            Runtime characteristics and shortcuts to the raw config surfaces.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-3xl border border-slate-200/80 bg-slate-50/70 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Access</div>
              <div className="mt-2 text-sm text-slate-800">
                {config.APIKEY ? "Protected by API key" : "Local-only bind unless host is overridden"}
              </div>
            </div>
            <div className="rounded-3xl border border-slate-200/80 bg-slate-50/70 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Timeout</div>
              <div className="mt-2 text-sm text-slate-800">
                {config.API_TIMEOUT_MS.toLocaleString()} ms request budget
              </div>
            </div>
            <div className="rounded-3xl border border-slate-200/80 bg-slate-50/70 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Logging</div>
              <div className="mt-2 text-sm text-slate-800">
                {config.LOG ? `Enabled at ${config.LOG_LEVEL}` : "Disabled"}
              </div>
            </div>
            <div className="rounded-3xl border border-slate-200/80 bg-slate-50/70 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Custom router</div>
              <div className="mt-2 text-sm text-slate-800">
                {config.CUSTOM_ROUTER_PATH ? "Local orchestrator active" : "Built-in routing only"}
              </div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" className="justify-start rounded-2xl" onClick={onOpenSettings}>
              <Settings2 className="h-4 w-4" />
              Runtime settings
            </Button>
            <Button variant="outline" className="justify-start rounded-2xl" onClick={onOpenJsonEditor}>
              <FileJson className="h-4 w-4" />
              Raw JSON editor
            </Button>
            <Button variant="outline" className="justify-start rounded-2xl" onClick={onOpenLogViewer}>
              <FileText className="h-4 w-4" />
              Live logs
            </Button>
            <Button variant="outline" className="justify-start rounded-2xl" onClick={onOpenPresets}>
              <Layers3 className="h-4 w-4" />
              Presets
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
