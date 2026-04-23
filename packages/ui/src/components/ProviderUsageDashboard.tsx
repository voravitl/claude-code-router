import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { api } from '../lib/api';
import { 
  Zap, 
  RefreshCw, 
  Activity, 
  DollarSign, 
  BarChart3, 
  AlertTriangle,
  CheckCircle2,
  Clock
} from 'lucide-react';

interface ProviderQuota {
  name: string;
  requestsUsedPct: number | null;
  tokensUsedPct: number | null;
  todayRequests: number;
  todayInputTokens: number;
  todayOutputTokens: number;
  todayCostUsd: number;
  updatedAt: string;
}

export function ProviderUsageDashboard() {
  const [quotas, setQuotas] = useState<ProviderQuota[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const fetchQuotas = async () => {
    setIsLoading(true);
    try {
      const data = await api.getProviderQuotas();
      setQuotas(data);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to fetch provider quotas:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchQuotas();
    const interval = setInterval(fetchQuotas, 30000); // 30s auto-refresh
    return () => clearInterval(interval);
  }, []);

  const getAlertColor = (pct: number | null) => {
    if (pct === null) return 'bg-slate-200';
    if (pct >= 90) return 'bg-red-500';
    if (pct >= 75) return 'bg-amber-500';
    return 'bg-green-500';
  };

  const getAlertTextColor = (pct: number | null) => {
    if (pct === null) return 'text-slate-500';
    if (pct >= 90) return 'text-red-500';
    if (pct >= 75) return 'text-amber-500';
    return 'text-green-500';
  };

  return (
    <Card className="flex h-full flex-col rounded-[2rem] border-white/70 bg-white/85 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur">
      <CardHeader className="flex flex-row items-center justify-between border-b border-slate-200/80 p-4">
        <div>
          <CardTitle className="text-lg text-slate-950 flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Provider Usage & Quotas
          </CardTitle>
          <CardDescription>
            Real-time tracking of API consumption and limits
          </CardDescription>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-slate-500 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Last updated: {lastUpdated.toLocaleTimeString()}
          </div>
          <Button variant="outline" size="icon" onClick={fetchQuotas} disabled={isLoading} className="rounded-full h-8 w-8">
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-grow overflow-y-auto p-6">
        {quotas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="bg-slate-100 p-4 rounded-full mb-4">
              <Zap className="h-8 w-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-medium">No Usage Data Yet</h3>
            <p className="text-slate-500 max-w-xs">
              Once you start making requests through the router, usage stats will appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {quotas.map((quota) => (
              <Card key={quota.name} className="overflow-hidden border-slate-200">
                <CardHeader className="p-4 bg-slate-50/50 border-b border-slate-100">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-base font-bold">{quota.name}</CardTitle>
                    <Badge variant="outline" className={`${getAlertTextColor(Math.max(quota.requestsUsedPct || 0, quota.tokensUsedPct || 0))} border-current bg-white`}>
                      {Math.max(quota.requestsUsedPct || 0, quota.tokensUsedPct || 0) >= 90 ? <AlertTriangle className="h-3 w-3 mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                      {Math.max(quota.requestsUsedPct || 0, quota.tokensUsedPct || 0) >= 90 ? 'Critical' : 'Healthy'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-4 space-y-4">
                  {/* Quota Progress */}
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Requests Quota</span>
                        <span className="font-medium">{quota.requestsUsedPct !== null ? `${quota.requestsUsedPct}%` : 'Unlimited'}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-500 ${getAlertColor(quota.requestsUsedPct)}`} 
                          style={{ width: `${quota.requestsUsedPct ?? 0}%` }}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Tokens Quota</span>
                        <span className="font-medium">{quota.tokensUsedPct !== null ? `${quota.tokensUsedPct}%` : 'Unlimited'}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-500 ${getAlertColor(quota.tokensUsedPct)}`} 
                          style={{ width: `${quota.tokensUsedPct ?? 0}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <div className="text-[10px] text-slate-500 uppercase flex items-center gap-1">
                        <RefreshCw className="h-2.5 w-2.5" /> Requests
                      </div>
                      <div className="text-sm font-bold">{quota.todayRequests}</div>
                    </div>
                    <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <div className="text-[10px] text-slate-500 uppercase flex items-center gap-1">
                        <DollarSign className="h-2.5 w-2.5" /> Today Cost
                      </div>
                      <div className="text-sm font-bold text-primary">${quota.todayCostUsd.toFixed(4)}</div>
                    </div>
                  </div>

                  <div className="text-[10px] text-slate-400 flex items-center gap-1">
                    <BarChart3 className="h-2.5 w-2.5" /> 
                    Tokens: {((quota.todayInputTokens + quota.todayOutputTokens) / 1000).toFixed(1)}k total
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
