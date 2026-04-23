import React, { useState } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from './ui/card';
import { PROVIDER_TEMPLATES } from '../lib/providerTemplates';
import type { ProviderTemplate } from '../lib/providerTemplates';
import type { Provider } from '../types';
import { api } from '../lib/api';
import { 
  Plus,
  Cpu,
  ExternalLink, 
  Check, 
  AlertCircle, 
  Loader2, 
  ArrowLeft,
  ChevronRight,
  Zap,
  Shield,
  Cloud
} from 'lucide-react';

interface QuickAddProviderProps {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
}

export const QuickAddProvider: React.FC<QuickAddProviderProps> = ({ isOpen, onClose, onAdded }) => {
  const [selectedTemplate, setSelectedTemplate] = useState<ProviderTemplate | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [providerName, setProviderName] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [newModel, setNewModel] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const handleSelectTemplate = (template: ProviderTemplate) => {
    setSelectedTemplate(template);
    setProviderName(template.id);
    setModels([...template.default_models]);
    setApiKey('');
    setTestResult(null);
  };

  const handleBack = () => {
    setSelectedTemplate(null);
    setTestResult(null);
  };

  const handleAddModel = () => {
    if (newModel && !models.includes(newModel)) {
      setModels([...models, newModel]);
      setNewModel('');
    }
  };

  const handleRemoveModel = (model: string) => {
    setModels(models.filter(m => m !== model));
  };

  const handleTestConnection = async () => {
    if (!selectedTemplate) return;

    setIsTesting(true);
    setTestResult(null);

    let addedIndex: number | null = null;
    try {
      // Temporarily add the provider so we can test it via /providers/:index/test
      const provider: Provider = {
        name: `__quicktest_${Date.now()}`,
        api_base_url: selectedTemplate.api_base_url,
        api_key: apiKey || selectedTemplate.api_key_placeholder,
        models: models.length ? [models[0]] : ['test'],
        _template: selectedTemplate.id,
        _capabilities: selectedTemplate.capabilities,
      };
      if (selectedTemplate.transformer) {
        provider.transformer = { use: [selectedTemplate.transformer] };
      }

      const addResult = await api.addProvider(provider);
      addedIndex = addResult.index;

      const result = await api.testProvider(addedIndex);
      setTestResult({ ok: result.ok, latencyMs: result.latencyMs, error: result.error });
    } catch (error: any) {
      setTestResult({ ok: false, error: error.message });
    } finally {
      // Remove the temporary provider after test regardless of outcome
      if (addedIndex !== null) {
        try {
          await api.deleteProvider(addedIndex);
        } catch {
          // Ignore cleanup errors
        }
      }
      setIsTesting(false);
    }
  };

  const handleAddProvider = async () => {
    if (!selectedTemplate) return;
    
    setIsAdding(true);
    try {
      const provider: Provider = {
        name: providerName,
        api_base_url: selectedTemplate.api_base_url,
        api_key: apiKey || 'none',
        models: models,
        _template: selectedTemplate.id,
        _capabilities: selectedTemplate.capabilities,
      };

      if (selectedTemplate.transformer) {
        provider.transformer = { use: [selectedTemplate.transformer] };
      }

      await api.addProvider(provider);
      onAdded();
      onClose();
      // Reset state
      setSelectedTemplate(null);
      setApiKey('');
    } catch (error) {
      console.error('Failed to add provider:', error);
    } finally {
      setIsAdding(false);
    }
  };

  const groupedTemplates = {
    'local': PROVIDER_TEMPLATES.filter(t => t.category === 'local'),
    'cloud-subscription': PROVIDER_TEMPLATES.filter(t => t.category === 'cloud-subscription'),
    'cloud-api': PROVIDER_TEMPLATES.filter(t => t.category === 'cloud-api'),
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {selectedTemplate ? (
              <Button variant="ghost" size="icon" onClick={handleBack} className="-ml-2">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            ) : <Plus className="h-5 w-5 text-primary" />}
            {selectedTemplate ? `Setup ${selectedTemplate.label}` : 'Quick Add Provider'}
          </DialogTitle>
          <DialogDescription>
            {selectedTemplate 
              ? `Configure your ${selectedTemplate.label} connection` 
              : 'Choose a provider template to get started quickly'}
          </DialogDescription>
        </DialogHeader>

        {!selectedTemplate ? (
          <div className="space-y-6 py-4">
            {Object.entries(groupedTemplates).map(([category, templates]) => (
              <div key={category} className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground capitalize flex items-center gap-2">
                  {category === 'local' && <Cpu className="h-4 w-4" />}
                  {category === 'cloud-subscription' && <Shield className="h-4 w-4" />}
                  {category === 'cloud-api' && <Cloud className="h-4 w-4" />}
                  {category.replace('-', ' ')}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {templates.map(template => (
                    <Card 
                      key={template.id} 
                      className="cursor-pointer hover:border-primary/50 transition-colors"
                      onClick={() => handleSelectTemplate(template)}
                    >
                      <CardHeader className="p-4 flex flex-row items-center gap-4 space-y-0">
                        <div className="text-2xl">{template.icon}</div>
                        <div className="flex-1">
                          <CardTitle className="text-base flex items-center gap-2">
                            {template.label}
                            {template.label.includes('⭐') && <Badge variant="secondary" className="text-[10px] py-0 px-1">REC</Badge>}
                          </CardTitle>
                          <CardDescription className="text-xs line-clamp-1">
                            {template.description}
                          </CardDescription>
                          <p className="text-[10px] text-muted-foreground/70 mt-0.5 italic">{template.pricing_hint}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-6 py-4">
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="apiKey" className="flex justify-between">
                  <span>{selectedTemplate.api_key_env || 'API Key'}</span>
                  {selectedTemplate.docs_url && (
                    <a 
                      href={selectedTemplate.docs_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-xs text-primary flex items-center gap-1 hover:underline"
                    >
                      Get Key <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </Label>
                <Input 
                  id="apiKey"
                  type="password"
                  placeholder={selectedTemplate.api_key_placeholder}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="font-mono"
                />
                {selectedTemplate.pricing_hint && (
                  <p className="text-xs text-muted-foreground italic">
                    Note: {selectedTemplate.pricing_hint}
                  </p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="providerName">Provider Display Name</Label>
                <Input 
                  id="providerName"
                  value={providerName}
                  onChange={(e) => setProviderName(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label>Models</Label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {models.map(model => (
                    <Badge key={model} variant="secondary" className="gap-1 px-2 py-1">
                      {model}
                      <button 
                        onClick={() => handleRemoveModel(model)}
                        className="hover:text-destructive transition-colors"
                      >
                        <Plus className="h-3 w-3 rotate-45" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input 
                    placeholder="Add custom model name..."
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddModel())}
                  />
                  <Button type="button" variant="outline" size="icon" onClick={handleAddModel}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {testResult && (
                <div className={`p-3 rounded-md flex items-start gap-3 ${testResult.ok ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-destructive/10 text-destructive'}`}>
                  {testResult.ok ? <Check className="h-5 w-5 mt-0.5" /> : <AlertCircle className="h-5 w-5 mt-0.5" />}
                  <div>
                    <p className="text-sm font-medium">
                      {testResult.ok ? 'Connection Successful' : 'Connection Failed'}
                    </p>
                    <p className="text-xs opacity-80">
                      {testResult.ok 
                        ? `Latency: ${testResult.latencyMs}ms. Provider is reachable.` 
                        : testResult.error || 'Could not connect to the provider API. Please check your API key and network.'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button 
                variant="outline" 
                onClick={handleTestConnection}
                disabled={isTesting || (selectedTemplate.api_key_required && !apiKey)}
                className="gap-2"
              >
                {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Test Connection
              </Button>
              <Button 
                onClick={handleAddProvider}
                disabled={isAdding || (selectedTemplate.api_key_required && !apiKey)}
                className="gap-2"
              >
                {isAdding && <Loader2 className="h-4 w-4 animate-spin" />}
                Add Provider
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
