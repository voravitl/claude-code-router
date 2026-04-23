import { Pencil, Trash2, Zap, Check, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { api } from "@/lib/api";
import { PROVIDER_TEMPLATES } from "@/lib/providerTemplates";
import type { Provider } from "@/types";

interface ProviderListProps {
  providers: Provider[];
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
}

export function ProviderList({ providers, onEdit, onRemove }: ProviderListProps) {
  const [testingIndex, setTestingIndex] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, { ok: boolean; latencyMs?: number; error?: string }>>({});

  const handleTest = async (index: number) => {
    setTestingIndex(index);
    try {
      const result = await api.testProvider(index);
      setTestResults(prev => ({ ...prev, [index]: result }));
    } catch (error: any) {
      setTestResults(prev => ({ ...prev, [index]: { ok: false, error: error.message } }));
    } finally {
      setTestingIndex(null);
    }
  };

  // Handle case where providers might be null or undefined
  if (!providers || !Array.isArray(providers)) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-center rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50/70 p-8 text-slate-500">
          No providers configured
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {providers.map((provider, index) => {
        // Handle case where individual provider might be null or undefined
        if (!provider) {
          return (
            <div key={index} className="animate-slide-in flex items-start justify-between rounded-[1.5rem] border border-slate-200/80 bg-slate-50/70 p-4 transition-all hover:scale-[1.01] hover:shadow-md">
              <div className="flex-1 space-y-1.5">
                <p className="text-md font-semibold text-slate-800">Invalid Provider</p>
                <p className="text-sm text-slate-500">Provider data is missing</p>
              </div>
              <div className="ml-4 flex flex-shrink-0 items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => onEdit(index)} className="transition-all-ease hover:scale-110" disabled>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="destructive" size="icon" onClick={() => onRemove(index)} className="transition-all duration-200 hover:scale-110">
                  <Trash2 className="h-4 w-4 text-current transition-colors duration-200" />
                </Button>
              </div>
            </div>
          );
        }

        // Handle case where provider.name might be null or undefined
        const providerName = provider.name || "Unnamed Provider";
        
        // Handle case where provider.api_base_url might be null or undefined
        const apiBaseUrl = provider.api_base_url || "No API URL";
        
        // Handle case where provider.models might be null or undefined
        const models = Array.isArray(provider.models) ? provider.models : [];

        const template = PROVIDER_TEMPLATES.find(t => t.id === provider._template);
        const testResult = testResults[index];

        return (
          <div key={index} className="animate-slide-in flex items-start justify-between rounded-[1.5rem] border border-slate-200/80 bg-slate-50/70 p-4 transition-all hover:scale-[1.01] hover:shadow-md">
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center gap-2">
                <p className="text-md font-semibold text-slate-800">{providerName}</p>
                {template && (
                  <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4">
                    {template.icon} {template.label}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-slate-500">{apiBaseUrl}</p>
              <div className="flex flex-wrap gap-2 pt-2">
                {models.map((model, modelIndex) => (
                  // Handle case where model might be null or undefined
                  <Badge key={modelIndex} variant="outline" className="font-normal transition-all-ease border-slate-300 bg-white/85 hover:scale-105">
                    {model || "Unnamed Model"}
                  </Badge>
                ))}
              </div>
              {testResult && (
                <div className={`mt-2 flex items-center gap-1.5 text-xs ${testResult.ok ? 'text-green-600' : 'text-red-600'}`}>
                  {testResult.ok ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                  {testResult.ok ? `Online (${testResult.latencyMs}ms)` : (testResult.error || 'Offline')}
                </div>
              )}
            </div>
            <div className="ml-4 flex flex-shrink-0 items-center gap-2">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => handleTest(index)} 
                disabled={testingIndex === index}
                className="transition-all-ease hover:scale-110 text-slate-500 hover:text-amber-500"
              >
                {testingIndex === index ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => onEdit(index)} className="transition-all-ease hover:scale-110">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="destructive" size="icon" onClick={() => onRemove(index)} className="transition-all duration-200 hover:scale-110">
                <Trash2 className="h-4 w-4 text-current transition-colors duration-200" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
