import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { MultiCombobox } from "@/components/ui/multi-combobox";
import { useConfig } from "./ConfigProvider";
import {
  ROUTING_TIER_GROUPS,
  buildModelOptions,
  getFallbacks,
  setFallbacks,
} from "@/lib/config";
import type { RouteSlot } from "@/types";
import { AlertTriangle, Gauge, Layers3, Sparkles } from "lucide-react";

export function Router() {
  const { t } = useTranslation();
  const { config, setConfig } = useConfig();

  if (!config) {
    return (
      <Card className="flex h-full flex-col rounded-[2rem] border-white/70 bg-white/85 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur">
        <CardHeader className="border-b border-slate-200/80">
          <CardTitle className="text-xl text-slate-950">{t("router.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 items-center justify-center p-6 text-slate-500">
          Loading routing configuration...
        </CardContent>
      </Card>
    );
  }

  const modelOptions = buildModelOptions(config);
  const keywordOptions = Array.from(
    new Set(config.Providers.flatMap((provider) => provider.models)),
  ).map((model) => ({
    value: model,
    label: model,
  }));

  const handleRouterChange = (field: RouteSlot | "longContextThreshold" | "opusKeyword" | "haikuModels", value: string | number | string[]) => {
    setConfig({
      ...config,
      Router: {
        ...config.Router,
        [field]: value,
      },
    });
  };

  const handleFallbackChange = (slot: RouteSlot, values: string[]) => {
    setConfig(setFallbacks(config, slot, values));
  };

  return (
    <Card className="overflow-hidden rounded-[2rem] border-white/70 bg-white/85 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur">
      <CardHeader className="border-b border-slate-200/80 bg-[linear-gradient(135deg,rgba(15,23,42,0.06),rgba(15,23,42,0))]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <CardTitle className="flex items-center gap-2 text-2xl text-slate-950">
              <Gauge className="h-6 w-6 text-slate-700" />
              Routing workbench
            </CardTitle>
            <CardDescription className="max-w-2xl text-sm leading-6 text-slate-600">
              Assign a primary model to each lane, then add fallbacks so failures degrade gracefully
              instead of breaking the session.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="rounded-full border-slate-300 bg-white/80 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-slate-600"
            >
              {modelOptions.length} route targets
            </Badge>
            <Badge
              variant="outline"
              className="rounded-full border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-emerald-700"
            >
              {config.fallback ? Object.keys(config.fallback).length : 0} fallback groups
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 p-4 md:p-6">
        {config.CUSTOM_ROUTER_PATH ? (
          <div className="flex items-start gap-3 rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">Custom router override is active</div>
              <div className="mt-1 text-amber-800/90">
                <code className="rounded bg-amber-100 px-1.5 py-0.5 text-[12px] text-amber-900">
                  CUSTOM_ROUTER_PATH
                </code>{" "}
                points to{" "}
                <code className="rounded bg-amber-100 px-1.5 py-0.5 text-[12px] text-amber-900">
                  {config.CUSTOM_ROUTER_PATH}
                </code>
                . These assignments still describe the intended policy, but the local router script
                may override them at runtime.
              </div>
            </div>
          </div>
        ) : null}

        {modelOptions.length === 0 ? (
          <div className="rounded-[1.75rem] border border-dashed border-slate-300 bg-slate-50/70 p-8 text-sm text-slate-600">
            Add providers and models first. Once route targets exist, each tier can be assigned from
            the lists below.
          </div>
        ) : null}

        {ROUTING_TIER_GROUPS.map((group) => (
          <section key={group.title} className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-slate-950">{group.title}</h3>
                <p className="mt-1 max-w-2xl text-sm text-slate-600">{group.description}</p>
              </div>
              <Badge
                variant="outline"
                className="rounded-full border-slate-300 bg-white/80 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-600"
              >
                {group.tiers.length} lanes
              </Badge>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {group.tiers.map((tier) => {
                const fallbackValues = getFallbacks(config, tier.key);

                return (
                  <div
                    key={tier.key}
                    className="rounded-[1.75rem] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,250,252,0.9))] p-4 shadow-[0_20px_50px_rgba(15,23,42,0.06)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="text-base font-semibold text-slate-950">{tier.label}</div>
                          <Badge
                            variant="outline"
                            className="rounded-full border-slate-300 bg-white/90 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-500"
                          >
                            {tier.badge}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{tier.description}</p>
                      </div>
                      <div className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-white">
                        {fallbackValues.length} fallbacks
                      </div>
                    </div>

                    <div className="mt-5 space-y-4">
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                          Primary model
                        </Label>
                        <Combobox
                          options={modelOptions}
                          value={config.Router[tier.key] as string}
                          onChange={(value) => handleRouterChange(tier.key, value)}
                          placeholder={t("router.selectModel")}
                          searchPlaceholder={t("router.searchModel")}
                          emptyPlaceholder={t("router.noModelFound")}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                          Automatic fallbacks
                        </Label>
                        <MultiCombobox
                          options={modelOptions}
                          value={fallbackValues}
                          onChange={(values) => handleFallbackChange(tier.key, values)}
                          placeholder="Select one or more fallback routes"
                          searchPlaceholder={t("router.searchModel")}
                          emptyPlaceholder={t("router.noModelFound")}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[1.75rem] border border-slate-200/80 bg-slate-50/70 p-5">
            <div className="flex items-center gap-2 text-lg font-semibold text-slate-950">
              <Layers3 className="h-5 w-5 text-slate-700" />
              Thresholds and heuristics
            </div>
            <p className="mt-2 text-sm text-slate-600">
              These fields shape how the router classifies requests before it reaches the model map.
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Long-context threshold
                </Label>
                <Input
                  type="number"
                  value={config.Router.longContextThreshold}
                  onChange={(event) =>
                    handleRouterChange("longContextThreshold", Number(event.target.value) || 0)
                  }
                  placeholder="40000"
                />
                <p className="text-xs leading-5 text-slate-500">
                  Requests above this token estimate will prefer the long-context lane.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Opus keyword
                </Label>
                <Input
                  value={config.Router.opusKeyword ?? ""}
                  onChange={(event) => handleRouterChange("opusKeyword", event.target.value)}
                  placeholder="opus"
                />
                <p className="text-xs leading-5 text-slate-500">
                  Lightweight keyword override for premium intent or special routing cases.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Haiku model aliases
              </Label>
              <MultiCombobox
                options={keywordOptions}
                value={config.Router.haikuModels ?? []}
                onChange={(values) => handleRouterChange("haikuModels", values)}
                placeholder="Select quick-answer aliases"
                searchPlaceholder="Search models..."
                emptyPlaceholder="No models found."
              />
              <p className="text-xs leading-5 text-slate-500">
                Shorthand aliases or model names used for fast, lightweight routing shortcuts.
              </p>
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(30,41,59,0.96))] p-5 text-slate-100 shadow-[0_24px_60px_rgba(15,23,42,0.22)]">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Sparkles className="h-5 w-5 text-amber-300" />
              Routing posture
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Keep the router explainable: primary path, failure path, and classification rules should
              all be legible from one screen.
            </p>

            <div className="mt-5 space-y-3 text-sm text-slate-200">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Image agent
                </div>
                <div className="mt-2 flex items-center justify-between gap-4">
                  <span className="text-slate-100">Force image agent on image routes</span>
                  <select
                    value={config.forceUseImageAgent ? "true" : "false"}
                    onChange={(event) =>
                      setConfig({ ...config, forceUseImageAgent: event.target.value === "true" })
                    }
                    className="h-10 rounded-xl border border-white/15 bg-slate-900 px-3 text-sm text-slate-100 outline-none"
                  >
                    <option value="false">{t("common.no")}</option>
                    <option value="true">{t("common.yes")}</option>
                  </select>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Current posture
                </div>
                <ul className="mt-3 space-y-2 text-slate-200/90">
                  <li>
                    {config.Router.longContext ? "Long-context route is assigned." : "Long-context route is not assigned yet."}
                  </li>
                  <li>
                    {config.Router.codeReview ? "Code review has its own lane." : "Code review still shares general routing."}
                  </li>
                  <li>
                    {config.fallback && Object.values(config.fallback).some((items) => (items?.length ?? 0) > 0)
                      ? "Fallbacks are configured for at least one route."
                      : "No fallbacks configured yet."}
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
