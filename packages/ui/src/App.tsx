import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Transformers } from "@/components/Transformers";
import { Providers } from "@/components/Providers";
import { Router } from "@/components/Router";
import { ConfigOverview } from "@/components/ConfigOverview";
import { JsonEditor } from "@/components/JsonEditor";
import { LogViewer } from "@/components/LogViewer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useConfig } from "@/components/ConfigProvider";
import { api } from "@/lib/api";
import { countAssignedRoutes, countFallbackCoverage, countModels } from "@/lib/config";
import {
  Settings,
  Languages,
  Save,
  RefreshCw,
  FileJson,
  CircleArrowUp,
  FileText,
  FileCog,
  Route,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import "@/styles/animations.css";

function App() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { config, error } = useConfig();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isJsonEditorOpen, setIsJsonEditorOpen] = useState(false);
  const [isLogViewerOpen, setIsLogViewerOpen] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);
  // 版本检查状态
  const [isNewVersionAvailable, setIsNewVersionAvailable] = useState(false);
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
  const [newVersionInfo, setNewVersionInfo] = useState<{ version: string; changelog: string } | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [hasCheckedUpdate, setHasCheckedUpdate] = useState(false);
  const [isUpdateFeatureAvailable, setIsUpdateFeatureAvailable] = useState(true);
  const hasAutoCheckedUpdate = useRef(false);

  const saveConfig = async () => {
    // Handle case where config might be null or undefined
    if (!config) {
      setToast({ message: t('app.config_missing'), type: 'error' });
      return;
    }
    
    try {
      // Save to API
      const response = await api.updateConfig(config);
      // Show success message or handle as needed
      console.log('Config saved successfully');
      
      // 根据响应信息进行提示
      if (response && typeof response === 'object' && 'success' in response) {
        const apiResponse = response as unknown as { success: boolean; message?: string };
        if (apiResponse.success) {
          setToast({ message: apiResponse.message || t('app.config_saved_success'), type: 'success' });
        } else {
          setToast({ message: apiResponse.message || t('app.config_saved_failed'), type: 'error' });
        }
      } else {
        // 默认成功提示
        setToast({ message: t('app.config_saved_success'), type: 'success' });
      }
    } catch (error) {
      console.error('Failed to save config:', error);
      // Handle error appropriately
      setToast({ message: t('app.config_saved_failed') + ': ' + (error as Error).message, type: 'error' });
    }
  };

  const saveConfigAndRestart = async () => {
    // Handle case where config might be null or undefined
    if (!config) {
      setToast({ message: t('app.config_missing'), type: 'error' });
      return;
    }
    
    try {
      // Save to API
      const response = await api.updateConfig(config);
      
      // Check if save was successful before restarting
      let saveSuccessful = true;
      if (response && typeof response === 'object' && 'success' in response) {
        const apiResponse = response as unknown as { success: boolean; message?: string };
        if (!apiResponse.success) {
          saveSuccessful = false;
          setToast({ message: apiResponse.message || t('app.config_saved_failed'), type: 'error' });
        }
      }
      
      // Only restart if save was successful
      if (saveSuccessful) {
        // Restart service
        const response = await api.restartService();
        
        // Show success message or handle as needed
        console.log('Config saved and service restarted successfully');
        
        // 根据响应信息进行提示
        if (response && typeof response === 'object' && 'success' in response) {
          const apiResponse = response as { success: boolean; message?: string };
          if (apiResponse.success) {
            setToast({ message: apiResponse.message || t('app.config_saved_restart_success'), type: 'success' });
          }
        } else {
          // 默认成功提示
          setToast({ message: t('app.config_saved_restart_success'), type: 'success' });
        }
      }
    } catch (error) {
      console.error('Failed to save config and restart:', error);
      // Handle error appropriately
      setToast({ message: t('app.config_saved_restart_failed') + ': ' + (error as Error).message, type: 'error' });
    }
  };
  
  // 检查更新函数
  const checkForUpdates = useCallback(async (showDialog: boolean = true) => {
    // 如果已经检查过且有新版本，根据参数决定是否显示对话框
    if (hasCheckedUpdate && isNewVersionAvailable) {
      if (showDialog) {
        setIsUpdateDialogOpen(true);
      }
      return;
    }
    
    setIsCheckingUpdate(true);
    try {
      const updateInfo = await api.checkForUpdates();
      
      if (updateInfo.hasUpdate && updateInfo.latestVersion && updateInfo.changelog) {
        setIsNewVersionAvailable(true);
        setNewVersionInfo({
          version: updateInfo.latestVersion,
          changelog: updateInfo.changelog
        });
        // 只有在showDialog为true时才显示对话框
        if (showDialog) {
          setIsUpdateDialogOpen(true);
        }
      } else if (showDialog) {
        // 只有在showDialog为true时才显示没有更新的提示
        setToast({ message: t('app.no_updates_available'), type: 'success' });
      }
      
      setHasCheckedUpdate(true);
    } catch (error) {
      console.error('Failed to check for updates:', error);
      setIsUpdateFeatureAvailable(false);
      if (showDialog) {
        setToast({ message: t('app.update_check_failed') + ': ' + (error as Error).message, type: 'error' });
      }
    } finally {
      setIsCheckingUpdate(false);
    }
  }, [hasCheckedUpdate, isNewVersionAvailable, t]);

  useEffect(() => {
    const checkAuth = async () => {
      // If we already have a config, we're authenticated
      if (config) {
        setIsCheckingAuth(false);
        // 自动检查更新，但不显示对话框
        if (!hasCheckedUpdate && !hasAutoCheckedUpdate.current) {
          hasAutoCheckedUpdate.current = true;
          checkForUpdates(false);
        }
        return;
      }
      
      // For empty API key, allow access without checking config
      const apiKey = localStorage.getItem('apiKey');
      if (!apiKey) {
        setIsCheckingAuth(false);
        return;
      }
      
      // If we don't have a config, try to fetch it
      try {
        await api.getConfig();
        // If successful, we don't need to do anything special
        // The ConfigProvider will handle setting the config
      } catch (err) {
        // If it's a 401, the API client will redirect to login
        // For other errors, we still show the app to display the error
        console.error('Error checking auth:', err);
        // Redirect to login on authentication error
        if ((err as Error).message === 'Unauthorized') {
          navigate('/login');
        }
      } finally {
        setIsCheckingAuth(false);
        // 在获取配置完成后检查更新，但不显示对话框
        if (!hasCheckedUpdate && !hasAutoCheckedUpdate.current) {
          hasAutoCheckedUpdate.current = true;
          checkForUpdates(false);
        }
      }
    };

    checkAuth();
    
    // Listen for unauthorized events
    const handleUnauthorized = () => {
      navigate('/login');
    };
    
    window.addEventListener('unauthorized', handleUnauthorized);
    
    return () => {
      window.removeEventListener('unauthorized', handleUnauthorized);
    };
  }, [config, navigate, hasCheckedUpdate, checkForUpdates]);
  
  // 执行更新函数
  const performUpdate = async () => {
    if (!newVersionInfo) return;
    
    try {
      const result = await api.performUpdate();
      
      if (result.success) {
        setToast({ message: t('app.update_successful'), type: 'success' });
        setIsNewVersionAvailable(false);
        setIsUpdateDialogOpen(false);
        setHasCheckedUpdate(false); // 重置检查状态，以便下次重新检查
      } else {
        setToast({ message: t('app.update_failed') + ': ' + result.message, type: 'error' });
      }
    } catch (error) {
      console.error('Failed to perform update:', error);
      setToast({ message: t('app.update_failed') + ': ' + (error as Error).message, type: 'error' });
    }
  };

  
  if (isCheckingAuth) {
    return (
      <div className="h-screen bg-gray-50 font-sans flex items-center justify-center">
        <div className="text-gray-500">Loading application...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen bg-gray-50 font-sans flex items-center justify-center">
        <div className="text-red-500">Error: {error.message}</div>
      </div>
    );
  }

  // Handle case where config is null or undefined
  if (!config) {
    return (
      <div className="h-screen bg-gray-50 font-sans flex items-center justify-center">
        <div className="text-gray-500">Loading configuration...</div>
      </div>
    );
  }

  const providerCount = config.Providers.length;
  const modelCount = countModels(config);
  const routeCount = countAssignedRoutes(config);
  const fallbackCoverage = countFallbackCoverage(config);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(241,245,249,0.95),transparent_38%),linear-gradient(180deg,#f7f5f1_0%,#eef2f7_45%,#f8fafc_100%)] font-sans">
        <div className="mx-auto max-w-[1680px] px-4 py-4 md:px-6">
          <header className="mb-4 flex flex-col gap-4 rounded-[1.75rem] border border-white/70 bg-white/75 px-5 py-4 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                Local Routing Control Plane
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{t('app.title')}</h1>
              <p className="mt-1 text-sm text-slate-600">
                Manifest-inspired dashboard for model routing, failover policy, and plugin orchestration.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={() => setIsSettingsOpen(true)} className="rounded-2xl">
                    <Settings className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('app.settings')}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={() => setIsJsonEditorOpen(true)} className="rounded-2xl">
                    <FileJson className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('app.json_editor')}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={() => setIsLogViewerOpen(true)} className="rounded-2xl">
                    <FileText className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('app.log_viewer')}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={() => navigate('/presets')} className="rounded-2xl">
                    <FileCog className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('app.presets')}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={() => navigate('/analytics')} className="rounded-2xl">
                    <Activity className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Analytics</p>
                </TooltipContent>
              </Tooltip>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-2xl">
                    <Languages className="h-5 w-5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-32 p-2">
                  <div className="space-y-1">
                    <Button
                      variant={i18n.language.startsWith('en') ? 'default' : 'ghost'}
                      className="w-full justify-start"
                      onClick={() => i18n.changeLanguage('en')}
                    >
                      English
                    </Button>
                    <Button
                      variant={i18n.language.startsWith('zh') ? 'default' : 'ghost'}
                      className="w-full justify-start"
                      onClick={() => i18n.changeLanguage('zh')}
                    >
                      中文
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
              {isUpdateFeatureAvailable && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => checkForUpdates(true)}
                      disabled={isCheckingUpdate}
                      className="relative rounded-2xl"
                    >
                      <div className="relative">
                        <CircleArrowUp className="h-5 w-5" />
                        {isNewVersionAvailable && !isCheckingUpdate && (
                          <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full border-2 border-white bg-red-500"></div>
                        )}
                      </div>
                      {isCheckingUpdate && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
                        </div>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t('app.check_updates')}</p>
                  </TooltipContent>
                </Tooltip>
              )}
              <Button onClick={saveConfig} variant="outline" className="rounded-2xl">
                <Save className="mr-2 h-4 w-4" />
                {t('app.save')}
              </Button>
              <Button onClick={saveConfigAndRestart} className="rounded-2xl">
                <RefreshCw className="mr-2 h-4 w-4" />
                {t('app.save_and_restart')}
              </Button>
            </div>
          </header>

          <main className="space-y-4 pb-6">
            <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <Card className="overflow-hidden rounded-[2rem] border-white/70 bg-[linear-gradient(135deg,rgba(15,23,42,0.98),rgba(30,41,59,0.93)_55%,rgba(71,85,105,0.86))] text-white shadow-[0_30px_90px_rgba(15,23,42,0.18)]">
                <CardContent className="p-6">
                  <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                    <div className="max-w-2xl">
                      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-300">
                        <Route className="h-3.5 w-3.5 text-amber-300" />
                        Routing Overview
                      </div>
                      <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                        Configure routing, fallbacks, and providers from one local dashboard.
                      </h2>
                      <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                        The goal is the same principle Manifest gets right: make routing policy visible,
                        editable, and explainable without dropping down to raw JSON for every change.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Badge className="rounded-full bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-white hover:bg-white/10">
                        {providerCount} providers
                      </Badge>
                      <Badge className="rounded-full bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-white hover:bg-white/10">
                        {modelCount} models
                      </Badge>
                      <Badge className="rounded-full bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-white hover:bg-white/10">
                        {config.transformers.length} transformers
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-3 md:grid-cols-3">
                    <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                        Tier coverage
                      </div>
                      <div className="mt-3 text-3xl font-semibold">{routeCount}/8</div>
                      <p className="mt-2 text-sm text-slate-300">Primary assignments currently mapped in the router.</p>
                    </div>
                    <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                        Fallback lanes
                      </div>
                      <div className="mt-3 text-3xl font-semibold">{fallbackCoverage}/8</div>
                      <p className="mt-2 text-sm text-slate-300">Automatic failover groups configured across routing lanes.</p>
                    </div>
                    <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                        Runtime posture
                      </div>
                      <div className="mt-3 flex items-center gap-2 text-lg font-semibold">
                        <ShieldCheck className="h-5 w-5 text-emerald-300" />
                        {config.APIKEY ? 'Protected' : 'Local only'}
                      </div>
                      <p className="mt-2 text-sm text-slate-300">
                        {config.CUSTOM_ROUTER_PATH ? 'Custom router script is active.' : 'Built-in routing drives behavior.'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <ConfigOverview
                onOpenSettings={() => setIsSettingsOpen(true)}
                onOpenJsonEditor={() => setIsJsonEditorOpen(true)}
                onOpenLogViewer={() => setIsLogViewerOpen(true)}
                onOpenPresets={() => navigate('/presets')}
              />
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
              <Router />
              <div className="min-h-0">
                <Providers />
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur">
                <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
                  Config principles
                </div>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                  What was pulled from Manifest
                </h3>
                <div className="mt-4 space-y-4 text-sm leading-7 text-slate-600">
                  <p>
                    Routing is now organized as explicit lanes instead of a flat form. Each lane shows
                    its primary model, fallback policy, and its role in the overall system.
                  </p>
                  <p>
                    The dashboard surfaces routing health before you edit anything: provider inventory,
                    fallback coverage, and operational posture are visible immediately.
                  </p>
                  <p>
                    Advanced tools are still here, but they are secondary surfaces now. That keeps the
                    common workflow on the main page while raw JSON and logs remain one click away.
                  </p>
                </div>
              </div>
              <div className="min-h-0">
                <Transformers />
              </div>
            </section>
          </main>
        </div>

        <SettingsDialog isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
        <JsonEditor
          open={isJsonEditorOpen}
          onOpenChange={setIsJsonEditorOpen}
          showToast={(message, type) => setToast({ message, type })}
        />
        <LogViewer
          open={isLogViewerOpen}
          onOpenChange={setIsLogViewerOpen}
          showToast={(message, type) => setToast({ message, type })}
        />
      {/* 版本更新对话框 */}
      <Dialog open={isUpdateDialogOpen} onOpenChange={setIsUpdateDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t('app.new_version_available')}
              {newVersionInfo && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  v{newVersionInfo.version}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              {t('app.update_description')}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto py-4">
            {newVersionInfo?.changelog ? (
              <div className="whitespace-pre-wrap text-sm">
                {newVersionInfo.changelog}
              </div>
            ) : (
              <div className="text-muted-foreground">
                {t('app.no_changelog_available')}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsUpdateDialogOpen(false)}
            >
              {t('app.later')}
            </Button>
            <Button onClick={performUpdate}>
              {t('app.update_now')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {toast && (
        <Toast 
          message={toast.message} 
          type={toast.type} 
          onClose={() => setToast(null)} 
        />
      )}
      </div>
    </TooltipProvider>
  );
}

export default App;
