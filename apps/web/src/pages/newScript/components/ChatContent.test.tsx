import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatContent } from './ChatContent';

describe('ChatContent', () => {
  it('renders common assistant markdown structures', () => {
    render(
      <ChatContent
        content={'## 任务摘要\n\n- **编队**已建立\n- `missile-1`\n\n```json\n{"status":"ready"}\n```\n\n[查看详情](https://example.com)'}
      />
    );

    expect(screen.getByRole('heading', { name: '任务摘要' })).toBeInTheDocument();
    expect(screen.getByText('编队').tagName).toBe('STRONG');
    expect(screen.getByText('missile-1').tagName).toBe('CODE');
    expect(screen.getByText('{"status":"ready"}').tagName).toBe('CODE');
    expect(screen.getByRole('link', { name: '查看详情' })).toHaveAttribute('href', 'https://example.com');
  });

  it('does not execute raw HTML from model output', () => {
    const { container } = render(<ChatContent content={'<script>alert(1)</script> **safe**'} />);

    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('safe')).toBeInTheDocument();
  });
});
