import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import {
  ArrowLeft,
  Activity,
  Zap,
  BarChart3,
  Clock,
  AlertTriangle,
  History,
  Trash2,
  RefreshCw,
  Cpu,
  Globe,
  CheckCircle2,
  XCircle,
  HardDrive
} from "lucide-react";
import { api } from "@/lib/api";
import { RoutingEvent, RoutingStats, ProviderHealth } from "@/types";
import { Toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function Analytics() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [stats, setStats] = useState<RoutingStats | null>(null);
  const [history, setHistory] = useState<RoutingEvent[]>([]);
  const [health, setHealth] = useState<ProviderHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);

  const fetchData = async () => {
    try {
      const [statsData, historyData, healthData] = await Promise.all([
        api.getRoutingStats(),
        api.getRoutingHistory(20, 0),
        api.getProviderHealth()
      ]);
      setStats(statsData);
      setHistory(historyData);
      setHealth(healthData);
    } catch (error) {
      console.error("Failed to fetch analytics data:", error);
      setToast({ message: "Failed to load analytics data", type: "error" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Auto refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const handleClearHistory = async () => {
    if (!confirm("Are you sure you want to clear all routing history?")) return;
    try {
      await api.clearRoutingHistory();
      setToast({ message: "History cleared", type: "success" });
      fetchData();
    } catch (error) {
      setToast({ message: "Failed to clear history", type: "error" });
    }
  };

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Activity className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  // Transform data for charts
  const providerData = stats ? Object.entries(stats.byProvider).map(([name, data]) => ({
    name,
    value: data.requests
  })) : [];

  const modelData = stats ? Object.entries(stats.byModel)
    .sort((a, b) => b[1].requests - a[1].requests)
    .slice(0, 5)
    .map(([name, data]) => ({
      name: name.split('/').pop() || name,
      requests: data.requests
    })) : [];

  const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6'];

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(241,245,249,0.95),transparent_38%),linear-gradient(180deg,#f7f5f1_0%,#eef2f7_45%,#f8fafc_100%)] font-sans px-4 py-4 md:px-6">
        <div className="mx-auto max-w-[1680px]">
          {/* Header */}
          <header className="mb-6 flex flex-col gap-4 rounded-[1.75rem] border border-white/70 bg-white/75 px-5 py-4 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')} className="rounded-2xl">
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
                  <Activity className="h-3.5 w-3.5 text-indigo-500" />
                  {t('analytics.description')}
                </div>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{t('analytics.title')}</h1>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="rounded-xl">
                <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Refreshing...' : t('analytics.refresh')}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleClearHistory} className="rounded-xl text-red-500 hover:text-red-600 hover:bg-red-50">
                <Trash2 className="mr-2 h-4 w-4" />
                {t('analytics.clear_history')}
              </Button>
            </div>
          </header>

          {/* Metrics Summary */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
            <MetricCard 
              title={t('analytics.total_requests')} 
              value={stats?.totalRequests || 0} 
              icon={<Zap className="h-4 w-4 text-amber-500" />}
              description="Lifetime requests routed"
            />
            <MetricCard 
              title={t('analytics.avg_latency')} 
              value={`${stats?.avgLatencyMs || 0}ms`} 
              icon={<Clock className="h-4 w-4 text-blue-500" />}
              description="End-to-end response time"
            />
            <MetricCard 
              title={t('analytics.total_tokens')} 
              value={`${((stats?.totalInputTokens || 0) + (stats?.totalOutputTokens || 0)).toLocaleString()}`} 
              icon={<Cpu className="h-4 w-4 text-indigo-500" />}
              description={`${stats?.totalInputTokens.toLocaleString()} in / ${stats?.totalOutputTokens.toLocaleString()} out`}
            />
            <MetricCard 
              title={t('analytics.error_rate')} 
              value={`${stats?.errorRate || 0}%`} 
              icon={<AlertTriangle className={`h-4 w-4 ${stats?.errorRate && stats.errorRate > 5 ? 'text-red-500' : 'text-emerald-500'}`} />}
              description={`${stats?.totalErrors || 0} failed requests`}
              trend={stats?.errorRate && stats.errorRate > 5 ? 'up' : 'down'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_400px] mb-6">
            {/* Main Stats Card */}
            <Card className="rounded-[2rem] border-white/70 bg-white/80 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur">
              <CardHeader>
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-indigo-500" />
                  {t('analytics.distribution')}
                </CardTitle>
                <CardDescription>Top 5 models by request volume</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={modelData} layout="vertical" margin={{ left: 40, right: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                      <XAxis type="number" hide />
                      <YAxis 
                        dataKey="name" 
                        type="category" 
                        axisLine={false} 
                        tickLine={false}
                        tick={{ fill: '#64748b', fontSize: 12 }}
                      />
                      <RechartsTooltip 
                        cursor={{ fill: 'rgba(226, 232, 240, 0.4)' }}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                      />
                      <Bar dataKey="requests" radius={[0, 4, 4, 0]}>
                        {modelData.map((_entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Provider Share */}
            <Card className="rounded-[2rem] border-white/70 bg-white/80 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur">
              <CardHeader>
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Globe className="h-5 w-5 text-indigo-500" />
                  {t('analytics.provider_share')}
                </CardTitle>
                <CardDescription>Traffic distribution by provider</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center">
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={providerData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {providerData.map((_entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2">
                  {providerData.map((entry, index) => (
                    <div key={entry.name} className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                      <span className="text-xs font-medium text-slate-600 truncate max-w-[120px]">{entry.name}</span>
                      <span className="text-xs text-slate-400">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-[400px_1fr]">
            {/* Provider Health */}
            <Card className="rounded-[2rem] border-white/70 bg-white/80 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur">
              <CardHeader>
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-emerald-500" />
                  {t('analytics.health')}
                </CardTitle>
                <CardDescription>Real-time status monitoring</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {health.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 text-sm">No health data available</div>
                  ) : (
                    health.map((p) => (
                      <div key={p.name} className="flex items-center justify-between p-3 rounded-2xl bg-slate-50/50 border border-slate-100">
                        <div className="flex items-center gap-3">
                          <div className={`h-2.5 w-2.5 rounded-full ${
                            p.status === 'online' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 
                            p.status === 'slow' ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' : 
                            'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                          }`} />
                          <div>
                            <div className="text-sm font-semibold text-slate-900">{p.name}</div>
                            <div className="text-[10px] text-slate-500">{p.models.length} models available</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-medium text-slate-700">{p.latencyMs}ms</div>
                          <div className="text-[10px] text-slate-400">{formatLastChecked(p.lastChecked)}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Recent History */}
            <Card className="rounded-[2rem] border-white/70 bg-white/80 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg font-semibold flex items-center gap-2">
                    <History className="h-5 w-5 text-indigo-500" />
                    {t('analytics.history')}
                  </CardTitle>
                  <CardDescription>Latest 20 routing events</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="pb-3 font-semibold text-slate-500">{t('analytics.time')}</th>
                        <th className="pb-3 font-semibold text-slate-500">Provider / Model</th>
                        <th className="pb-3 font-semibold text-slate-500 text-center">{t('analytics.tokens')}</th>
                        <th className="pb-3 font-semibold text-slate-500 text-center">{t('analytics.latency')}</th>
                        <th className="pb-3 font-semibold text-slate-500 text-right">{t('analytics.status')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {history.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-400">No routing history found</td>
                        </tr>
                      ) : (
                        history.map((event, idx) => (
                          <tr key={`${event.sessionId}-${idx}`} className="group hover:bg-slate-50/50 transition-colors">
                            <td className="py-3 text-slate-500 tabular-nums">
                              {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </td>
                            <td className="py-3">
                              <div className="font-medium text-slate-900">{event.provider}</div>
                              <div className="text-xs text-slate-400 truncate max-w-[200px]">{event.model}</div>
                            </td>
                            <td className="py-3 text-center tabular-nums">
                              <div className="text-xs text-slate-600">{event.inputTokens} / {event.outputTokens}</div>
                            </td>
                            <td className="py-3 text-center tabular-nums font-medium text-slate-700">
                              {event.latencyMs}ms
                            </td>
                            <td className="py-3 text-right">
                              {event.status === 'success' ? (
                                <Badge className="bg-emerald-50 text-emerald-600 border-emerald-100 shadow-none">
                                  <CheckCircle2 className="mr-1 h-3 w-3" />
                                  {t('analytics.success')}
                                </Badge>
                              ) : (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Badge variant="destructive" className="bg-red-50 text-red-600 border-red-100 shadow-none">
                                        <XCircle className="mr-1 h-3 w-3" />
                                        {t('analytics.error')}
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="max-w-xs">{event.errorMessage || 'Unknown error'}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {toast && (
        <Toast 
          message={toast.message} 
          type={toast.type} 
          onClose={() => setToast(null)} 
        />
      )}
    </TooltipProvider>
  );
}

function MetricCard({ title, value, icon, description, trend }: { 
  title: string; 
  value: string | number; 
  icon: React.ReactNode;
  description: string;
  trend?: 'up' | 'down';
}) {
  return (
    <Card className="rounded-[2rem] border-white/70 bg-white/80 shadow-[0_12px_40px_rgba(15,23,42,0.04)] backdrop-blur transition-all hover:shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">{title}</div>
          <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">{icon}</div>
        </div>
        <div className="flex items-baseline gap-2">
          <div className="text-2xl font-bold tracking-tight text-slate-900">{value}</div>
          {trend && (
            <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              trend === 'down' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
            }`}>
              {trend === 'down' ? '↓' : '↑'}
            </div>
          )}
        </div>
        <div className="mt-1 text-[11px] text-slate-500">{description}</div>
      </CardContent>
    </Card>
  );
}

function formatLastChecked(isoString: string) {
  const date = new Date(isoString);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
