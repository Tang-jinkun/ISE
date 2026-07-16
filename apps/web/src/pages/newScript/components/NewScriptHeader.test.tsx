import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NewScriptHeader } from './NewScriptHeader';

function renderHeader(overrides: Partial<Parameters<typeof NewScriptHeader>[0]> = {}) {
  const props: Parameters<typeof NewScriptHeader>[0] = {
    title: '',
    onTitleChange: vi.fn(),
    onBack: vi.fn(),
    onOpenLegacy: vi.fn(),
    onConfigureModel: vi.fn(),
    modelLabel: '配置模型',
    modelConfigError: false,
    exports: {},
    saving: false,
    onSave: vi.fn(),
    previewEnabled: false,
    onPreview: vi.fn(),
    ...overrides
  };
  return { ...render(<NewScriptHeader {...props} />), props };
}

describe('NewScriptHeader', () => {
  it('routes navigation commands and edits the project title', () => {
    const { props } = renderHeader();

    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    fireEvent.click(screen.getByRole('button', { name: '返回旧版' }));
    fireEvent.change(screen.getByPlaceholderText('未命名脚本项目'), {
      target: { value: '印巴空中对抗' }
    });

    expect(props.onBack).toHaveBeenCalledTimes(1);
    expect(props.onOpenLegacy).toHaveBeenCalledTimes(1);
    expect(props.onTitleChange).toHaveBeenCalledWith('印巴空中对抗');
  });

  it('exposes model configuration and save as compact commands', () => {
    const { props } = renderHeader({ modelLabel: 'DeepSeek · deepseek-chat' });

    fireEvent.click(
      screen.getByRole('button', { name: 'DeepSeek · deepseek-chat' })
    );
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(props.onConfigureModel).toHaveBeenCalledTimes(1);
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it('enables preview only after a validated runtime is available', () => {
    const disabled = renderHeader();
    expect(screen.getByRole('button', { name: '预览' })).toBeDisabled();
    disabled.unmount();

    const { props } = renderHeader({ previewEnabled: true });
    fireEvent.click(screen.getByRole('button', { name: '预览' }));
    expect(props.onPreview).toHaveBeenCalledTimes(1);
  });

  it('disables save while a save request is active', () => {
    renderHeader({ saving: true });

    expect(screen.getByRole('button', { name: '保存中' })).toBeDisabled();
  });
});
