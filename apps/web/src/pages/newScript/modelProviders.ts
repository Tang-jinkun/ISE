import type { ModelProviderId } from '@/api/agent';

export type ModelProviderPreset = {
  id: ModelProviderId;
  label: string;
  baseUrl: string;
  defaultModel: string;
  local: boolean;
};

export const MODEL_PROVIDERS: ModelProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    local: false
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1',
    local: false
  },
  {
    id: 'qwen',
    label: 'Qwen / DashScope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    local: false
  },
  {
    id: 'kimi',
    label: 'Kimi / Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-32k',
    local: false
  },
  {
    id: 'zhipu',
    label: 'Zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-plus',
    local: false
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: '',
    local: false
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: '',
    local: false
  },
  {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: '',
    local: true
  },
  {
    id: 'lm-studio',
    label: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    defaultModel: '',
    local: true
  },
  {
    id: 'vllm',
    label: 'vLLM',
    baseUrl: 'http://127.0.0.1:8000/v1',
    defaultModel: '',
    local: true
  },
  {
    id: 'custom',
    label: '自定义 OpenAI-compatible',
    baseUrl: 'https://',
    defaultModel: '',
    local: false
  }
];

export const modelProvider = (id: ModelProviderId): ModelProviderPreset =>
  MODEL_PROVIDERS.find((provider) => provider.id === id) ?? MODEL_PROVIDERS[0]!;
