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
  Activity,
  Zap,
  ShieldCheck,
  Sparkles,
  LayoutGrid,
  Layers3,
  PlugZap,
  BarChart3,
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

type TabId = "overview" | "routing" | "providers" | "transformers";

function App() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { config, error } = useConfig();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
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
      const response = await api.updateConfig(config);
      console.log('Config saved, restarting...');
      
      if (response && typeof response === 'object' && 'success' in response) {
        const apiResponse = response as unknown as { success: boolean; message?: string };
        if (apiResponse.success) {
          setToast({ message: t('app.config_saved_restarting'), type: 'success' });
        } else {
          setToast({ message: apiResponse.message || t('app.config_saved_failed'), type: 'error' });
          return;
        }
      } else {
        setToast({ message: t('app.config_saved_restarting'), type: 'success' });
      }
      
      // Wait a moment before restarting
      setTimeout(async () => {
        try {
          await api.restartService();
        } catch (error) {
          console.error('Failed to restart:', error);
        }
      }, 300);
    } catch (error) {
      console.error('Failed to save and restart:', error);
      setToast({ message: t('app.config_saved_failed') + ': ' + (error as Error).message, type: 'error' });
    }
  };

  const checkForUpdates = useCallback(async (showDialog = true) => {
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
      } catch (err) {
        console.error('Error checking auth:', err);
        if ((err as Error).message === 'Unauthorized') {
          navigate('/login');
        }
      } finally {
        setIsCheckingAuth(false);
        if (!hasCheckedUpdate && !hasAutoCheckedUpdate.current) {
          hasAutoCheckedUpdate.current = true;
          checkForUpdates(false);
        }
      }
    };

    checkAuth();
    
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
      <div className="h-screen font-sans flex items-center justify-center bg-[--background]">
        <div className="text-[--muted-foreground]">Loading application...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen font-sans flex items-center justify-center bg-[--background]">
        <div className="text-red-600">Error: {error.message}</div>
      </div>
    );
  }

  // Handle case where config is null or undefined
  if (!config) {
    return (
      <div className="h-screen font-sans flex items-center justify-center bg-[--background]">
        <div className="text-[--muted-foreground]">Loading configuration...</div>
      </div>
    );
  }

  const providerCount = config.Providers.length;
  const modelCount = countModels(config);
  const routeCount = countAssignedRoutes(config);
  const fallbackCoverage = countFallbackCoverage(config);

  const tabs: { id: TabId; label: string; icon: typeof LayoutGrid }[] = [
    { id: "overview", label: t('app.tab_overview') || "Overview", icon: LayoutGrid },
    { id: "routing", label: t('app.tab_routing') || "Routing", icon: Route },
    { id: "providers", label: t('app.tab_providers') || "Providers", icon: Layers3 },
    { id: "transformers", label: t('app.tab_transformers') || "Transformers", icon: PlugZap },
  ];

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-[--background] font-sans">
        <div className="mx-auto max-w-[1480px] px-4 py-3 md:px-6">

          {/* ── Compact Header ── */}
          <header className="mb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold tracking-tight text-[--foreground]">
                {t('app.title')}
              </h1>
              {/* Status chips */}
              <div className="hidden items-center gap-1.5 md:flex">
                <Badge variant="outline" className="rounded-full px-2.5 py-0.5 text-[10px] font-medium text-slate-600 border-slate-200 bg-slate-50">
                  {providerCount} providers
                </Badge>
                <Badge variant="outline" className="rounded-full px-2.5 py-0.5 text-[10px] font-medium text-slate-600 border-slate-200 bg-slate-50">
                  {routeCount}/8 routes
                </Badge>
                <Badge variant="outline" className="rounded-full px-2.5 py-0.5 text-[10px] font-medium text-slate-600 border-slate-200 bg-slate-50">
                  {config.transformers.length} transformers
                </Badge>
                <div className={`ml-1 h-1.5 w-1.5 rounded-full ${config.APIKEY ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                <span className="text-[10px] text-slate-500">{config.APIKEY ? 'Protected' : 'Local'}</span>
              </div>
            </div>

            {/* Action buttons — labeled, not icon-only */}
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => navigate('/analytics')} className="text-xs gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" />
                Analytics
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setIsLogViewerOpen(true)} className="text-xs gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                Logs
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setIsJsonEditorOpen(true)} className="text-xs gap-1.5">
                <FileJson className="h-3.5 w-3.5" />
                JSON
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-xs gap-1.5">
                    <Languages className="h-3.5 w-3.5" />
                    {i18n.language.startsWith('th') ? 'TH' : i18n.language.startsWith('zh') ? 'CN' : 'EN'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-32 p-1" align="end">
                  <div className="space-y-0.5">
                    <Button
                      variant={i18n.language.startsWith('en') ? 'default' : 'ghost'}
                      size="sm"
                      className="w-full justify-start text-xs"
                      onClick={() => i18n.changeLanguage('en')}
                    >
                      English
                    </Button>
                    <Button
                      variant={i18n.language.startsWith('zh') ? 'default' : 'ghost'}
                      size="sm"
                      className="w-full justify-start text-xs"
                      onClick={() => i18n.changeLanguage('zh')}
                    >
                      中文
                    </Button>
                    <Button
                      variant={i18n.language.startsWith('th') ? 'default' : 'ghost'}
                      size="sm"
                      className="w-full justify-start text-xs"
                      onClick={() => i18n.changeLanguage('th')}
                    >
                      ไทย
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
                      className="relative h-8 w-8"
                    >
                      <div className="relative">
                        <CircleArrowUp className="h-4 w-4" />
                        {isNewVersionAvailable && !isCheckingUpdate && (
                          <div className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-white bg-red-500"></div>
                        )}
                      </div>
                      {isCheckingUpdate && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
                        </div>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t('app.check_updates')}</p>
                  </TooltipContent>
                </Tooltip>
              )}

              <div className="mx-1 h-5 w-px bg-slate-200" />

              <Button onClick={saveConfig} variant="outline" size="sm" className="text-xs gap-1.5">
                <Save className="h-3.5 w-3.5" />
                {t('app.save')}
              </Button>
              <Button onClick={saveConfigAndRestart} size="sm" className="text-xs gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                {t('app.save_and_restart')}
              </Button>
            </div>
          </header>

          {/* ── Tab Navigation ── */}
          <nav className="mb-4 flex items-center gap-1 border-b border-slate-200 pb-px">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors relative ${
                  activeTab === tab.id
                    ? 'text-[--foreground]'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
                {activeTab === tab.id && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[--foreground] rounded-full" />
                )}
              </button>
            ))}
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => setIsSettingsOpen(true)} className="text-xs gap-1.5 text-slate-500">
              <Settings className="h-3.5 w-3.5" />
              {t('app.settings')}
            </Button>
          </nav>

          {/* ── Tab Content ── */}
          <main className="pb-6">
            {activeTab === "overview" && (
              <div className="grid gap-4 xl:grid-cols-2">
                <ConfigOverview
                  onOpenSettings={() => setIsSettingsOpen(true)}
                  onOpenJsonEditor={() => setIsJsonEditorOpen(true)}
                  onOpenLogViewer={() => setIsLogViewerOpen(true)}
                  onOpenPresets={() => navigate('/presets')}
                />
                <div className="space-y-4">
                  <Router />
                </div>
              </div>
            )}

            {activeTab === "routing" && (
              <Router />
            )}

            {activeTab === "providers" && (
              <Providers />
            )}

            {activeTab === "transformers" && (
              <Transformers />
            )}
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
