import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ChatComposer } from './ChatComposer';

function ComposerHarness({
  onSend = vi.fn(),
  disabled = false,
  error = null
}: {
  onSend?: () => void;
  disabled?: boolean;
  error?: string | null;
}) {
  const [value, setValue] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  return (
    <ChatComposer
      value={value}
      attachment={attachment}
      disabled={disabled}
      error={error}
      onValueChange={setValue}
      onAttachmentChange={setAttachment}
      onSend={onSend}
    />
  );
}

const docx = () =>
  new File(['report'], 'report.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });

describe('ChatComposer', () => {
  it('keeps a selected DOCX pending and enables attachment-only send', () => {
    const onSend = vi.fn();
    render(<ComposerHarness onSend={onSend} />);

    fireEvent.change(
      screen.getByLabelText('添加 DOCX 附件', { selector: 'input' }),
      { target: { files: [docx()] } }
    );

    expect(screen.getByText('report.docx')).toBeInTheDocument();
    expect(screen.getByText('6 B')).toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
    const send = screen.getByRole('button', { name: '发送消息' });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('removes a pending attachment without sending it', () => {
    const onSend = vi.fn();
    render(<ComposerHarness onSend={onSend} />);

    fireEvent.change(
      screen.getByLabelText('添加 DOCX 附件', { selector: 'input' }),
      { target: { files: [docx()] } }
    );
    fireEvent.click(screen.getByRole('button', { name: '移除附件' }));

    expect(screen.queryByText('report.docx')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends on Enter and keeps Shift+Enter for a new line', () => {
    const onSend = vi.fn();
    render(<ComposerHarness onSend={onSend} />);
    const input = screen.getByPlaceholderText('描述你想生成的场景...');
    fireEvent.change(input, { target: { value: '生成港口态势场景' } });

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('disables all submission controls while sending and keeps local errors visible', () => {
    render(<ComposerHarness disabled error="模型服务不可用" />);

    expect(screen.getByPlaceholderText('描述你想生成的场景...')).toBeDisabled();
    expect(screen.getByRole('button', { name: '添加 DOCX 附件' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('模型服务不可用');
  });
});
