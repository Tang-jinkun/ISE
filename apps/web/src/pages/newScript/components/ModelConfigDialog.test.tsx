import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicModelConfig } from '@/api/agent';
import { ModelConfigDialog } from './ModelConfigDialog';

const mocks = vi.hoisted(() => ({
  clearModelConfig: vi.fn(),
  discoverModels: vi.fn(),
  saveModelConfig: vi.fn(),
  testModelConfig: vi.fn()
}));

vi.mock('@/api/agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/agent')>()),
  clearModelConfig: mocks.clearModelConfig,
  discoverModels: mocks.discoverModels,
  saveModelConfig: mocks.saveModelConfig,
  testModelConfig: mocks.testModelConfig
}));

const configured: PublicModelConfig = {
  configured: true,
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  hasApiKey: true
};

const empty: PublicModelConfig = {
  configured: false,
  provider: null,
  baseUrl: null,
  model: null,
  hasApiKey: false
};

function renderDialog(
  config: PublicModelConfig = configured,
  onConfigChange = vi.fn(),
  onOpenChange = vi.fn()
) {
  render(
    <ModelConfigDialog
      open
      onOpenChange={onOpenChange}
      config={config}
      onConfigChange={onConfigChange}
    />
  );
  return { onConfigChange, onOpenChange };
}

describe('ModelConfigDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.discoverModels.mockResolvedValue({ models: ['deepseek-chat'] });
    mocks.testModelConfig.mockResolvedValue({
      ok: true,
      model: 'deepseek-chat',
      modelAvailable: true
    });
    mocks.saveModelConfig.mockResolvedValue(configured);
    mocks.clearModelConfig.mockResolvedValue(empty);
  });

  it('defaults an unconfigured DeepSeek user to deepseek-v4-pro', () => {
    renderDialog(empty);

    expect(screen.getByLabelText('提供商')).toHaveValue('deepseek');
    expect(screen.getByLabelText('模型')).toHaveValue('deepseek-v4-pro');
    expect(screen.getByLabelText('API Key')).toHaveValue('');
  });

  it('loads redacted current values without rendering the stored key', () => {
    renderDialog();

    expect(screen.getByRole('dialog', { name: '模型配置' })).toBeInTheDocument();
    expect(screen.getByLabelText('提供商')).toHaveValue('deepseek');
    expect(screen.getByLabelText('Base URL')).toHaveValue(
      'https://api.deepseek.com/v1'
    );
    expect(screen.getByLabelText('模型')).toHaveValue('deepseek-chat');
    expect(screen.getByLabelText('API Key')).toHaveValue('');
    expect(screen.queryByDisplayValue('test-secret')).not.toBeInTheDocument();
  });

  it('closes only when the user explicitly cancels without changing config', () => {
    const { onConfigChange, onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfigChange).not.toHaveBeenCalled();
  });

  it('applies local provider defaults and allows a keyless configuration', () => {
    renderDialog(empty);

    fireEvent.change(screen.getByLabelText('提供商'), {
      target: { value: 'ollama' }
    });

    expect(screen.getByLabelText('Base URL')).toHaveValue(
      'http://127.0.0.1:11434/v1'
    );
    expect(screen.getByLabelText('API Key')).not.toBeRequired();
  });

  it('discovers models and tests the current transient configuration', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'new-secret' }
    });
    fireEvent.click(screen.getByRole('button', { name: '获取模型' }));

    await waitFor(() => expect(mocks.discoverModels).toHaveBeenCalledTimes(1));
    expect(mocks.discoverModels).toHaveBeenCalledWith({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'new-secret'
    });
    expect(
      document.querySelector('datalist option[value="deepseek-chat"]')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    expect(await screen.findByText('连接正常')).toBeInTheDocument();
  });

  it('saves, clears the password field, updates status, and closes', async () => {
    const { onConfigChange, onOpenChange } = renderDialog();
    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'new-secret' }
    });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => expect(mocks.saveModelConfig).toHaveBeenCalledTimes(1));
    expect(onConfigChange).toHaveBeenCalledWith(configured);
    expect(screen.getByLabelText('API Key')).toHaveValue('');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('clears only after the Agent confirms the reset', async () => {
    const { onConfigChange } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '清除配置' }));

    await waitFor(() => expect(mocks.clearModelConfig).toHaveBeenCalledTimes(1));
    expect(onConfigChange).toHaveBeenCalledWith(empty);
  });
});
