import { useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw, Trash2, Wifi } from 'lucide-react';
import {
  clearModelConfig,
  discoverModels,
  saveModelConfig,
  testModelConfig,
  type ModelConfigInput,
  type ModelProviderId,
  type PublicModelConfig
} from '@/api/agent';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { MODEL_PROVIDERS, modelProvider } from '../modelProviders';

type ModelConfigDialogProps = {
  open: boolean;
  onOpenChange(value: boolean): void;
  config: PublicModelConfig;
  onConfigChange(value: PublicModelConfig): void;
};

type Action = 'discover' | 'test' | 'save' | 'clear' | null;

const errorText = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message
    : '模型配置请求失败';

export function ModelConfigDialog({
  open,
  onOpenChange,
  config,
  onConfigChange
}: ModelConfigDialogProps) {
  const initialProvider = config.provider ?? 'deepseek';
  const [provider, setProvider] = useState<ModelProviderId>(initialProvider);
  const [baseUrl, setBaseUrl] = useState(
    config.baseUrl ?? modelProvider(initialProvider).baseUrl
  );
  const [model, setModel] = useState(
    config.model ?? modelProvider(initialProvider).defaultModel
  );
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [action, setAction] = useState<Action>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const nextProvider = config.provider ?? 'deepseek';
    const preset = modelProvider(nextProvider);
    setProvider(nextProvider);
    setBaseUrl(config.baseUrl ?? preset.baseUrl);
    setModel(config.model ?? preset.defaultModel);
    setApiKey('');
    setModels([]);
    setError(null);
    setTestResult(null);
  }, [config, open]);

  const preset = modelProvider(provider);
  const input = (): ModelConfigInput => ({
    provider,
    baseUrl: baseUrl.trim(),
    model: model.trim(),
    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {})
  });

  const run = async (nextAction: Exclude<Action, null>, task: () => Promise<void>) => {
    if (action) return;
    setAction(nextAction);
    setError(null);
    setTestResult(null);
    try {
      await task();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setAction(null);
    }
  };

  const changeProvider = (value: string) => {
    const nextProvider = value as ModelProviderId;
    const nextPreset = modelProvider(nextProvider);
    setProvider(nextProvider);
    setBaseUrl(nextPreset.baseUrl);
    setModel(nextPreset.defaultModel);
    setApiKey('');
    setModels([]);
    setError(null);
    setTestResult(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-md">
        <DialogHeader>
          <DialogTitle>模型配置</DialogTitle>
          <DialogDescription className="sr-only">
            配置 Agent 使用的 OpenAI-compatible 模型服务
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <Label htmlFor="model-provider">提供商</Label>
            <Select
              id="model-provider"
              aria-label="提供商"
              value={provider}
              disabled={Boolean(action)}
              onValueChange={changeProvider}
            >
              {MODEL_PROVIDERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="model-base-url">Base URL</Label>
            <Input
              id="model-base-url"
              aria-label="Base URL"
              value={baseUrl}
              disabled={Boolean(action)}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="model-name">模型</Label>
              <button
                type="button"
                disabled={Boolean(action) || !baseUrl.trim()}
                onClick={() =>
                  void run('discover', async () => {
                    const response = await discoverModels(input());
                    setModels(response.models);
                    if (!model && response.models[0]) setModel(response.models[0]);
                  })
                }
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                {action === 'discover' ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                获取模型
              </button>
            </div>
            <Input
              id="model-name"
              aria-label="模型"
              list="model-options"
              value={model}
              disabled={Boolean(action)}
              onChange={(event) => setModel(event.target.value)}
            />
            <datalist id="model-options">
              {models.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </datalist>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="model-api-key">API Key</Label>
            <Input
              id="model-api-key"
              aria-label="API Key"
              type="password"
              value={apiKey}
              required={!preset.local && !config.hasApiKey}
              disabled={Boolean(action)}
              autoComplete="new-password"
              onChange={(event) => setApiKey(event.target.value)}
            />
          </div>

          {testResult && (
            <p role="status" className="text-xs text-emerald-600 dark:text-emerald-400">
              {testResult}
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <button
            type="button"
            disabled={Boolean(action) || !config.configured}
            onClick={() =>
              void run('clear', async () => {
                const next = await clearModelConfig();
                setApiKey('');
                onConfigChange(next);
              })
            }
            className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            清除配置
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={Boolean(action)}
              onClick={() => onOpenChange(false)}
              className="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              disabled={Boolean(action) || !baseUrl.trim() || !model.trim()}
              onClick={() =>
                void run('test', async () => {
                  const response = await testModelConfig(input());
                  setTestResult(
                    response.modelAvailable ? '连接正常' : '连接正常，模型未在列表中'
                  );
                })
              }
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              <Wifi className="h-4 w-4" />
              测试连接
            </button>
            <button
              type="button"
              disabled={Boolean(action) || !baseUrl.trim() || !model.trim()}
              onClick={() =>
                void run('save', async () => {
                  const next = await saveModelConfig(input());
                  setApiKey('');
                  onConfigChange(next);
                  onOpenChange(false);
                })
              }
              className="inline-flex h-9 items-center rounded-md bg-cyan-600 px-4 text-sm font-medium text-white transition-colors hover:bg-cyan-700 disabled:opacity-50"
            >
              保存配置
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
