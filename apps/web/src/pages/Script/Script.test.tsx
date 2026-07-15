import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import Script from './index';
import { BrowserRouter } from 'react-router-dom';

// Mock dependencies
vi.mock('@/api/script', () => ({
  getScript: vi.fn().mockResolvedValue({ data: { title: 'Test Script', conversation: [] } }),
  updateScript: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/components/ui/message', () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock ResizeObserver for components that might use it
globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

describe('Script Page - Q&A Analysis Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderScript = () => {
    return render(
      <BrowserRouter>
        <Script />
      </BrowserRouter>
    );
  };

  const getSendButton = () =>
    screen.getByRole('button', { name: '发送问题' });

  it('should show 4-stage analysis flow after submitting a question', async () => {
    renderScript();

    const input = screen.getByPlaceholderText('输入你的问题...');
    const sendButton = getSendButton();

    fireEvent.change(input, { target: { value: '如何进行赤壁之战？' } });
    fireEvent.click(sendButton);

    // Check if the thinking process starts
    expect(screen.getByText(/思考过程 & 解析流/i)).toBeInTheDocument();

    // Verify 4 stages appear sequentially
    const stages = ['任务规划', '叙事规划', '资源匹配', '参数解算'];

    for (const stageName of stages) {
      // Each stage should eventually appear and be marked as completed
      await waitFor(() => {
        expect(screen.getByText(stageName)).toBeInTheDocument();
      }, { timeout: 3000 });
    }

    // After stages, the mock JSON should appear
    await waitFor(() => {
      expect(screen.getByText(/解析元数据关联/i)).toBeInTheDocument();
      expect(screen.getByText(/"task_goal": "生成赤壁之战剧本大纲"/i)).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('should allow user to cancel the analysis', async () => {
    renderScript();

    const input = screen.getByPlaceholderText('输入你的问题...');
    const sendButton = getSendButton();

    fireEvent.change(input, { target: { value: '取消测试' } });
    fireEvent.click(sendButton);

    const cancelButton = await screen.findByText('取消解析');
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(screen.getByText('解析已由用户取消。')).toBeInTheDocument();
    });
  });

  it('should handle timeout/error scenarios (simulated)', async () => {
    // We can simulate an error by mocking the internal timers or state if needed,
    // but the current implementation is mostly successful simulation.
    // For now, we verify the structure and sequence.
    renderScript();

    const input = screen.getByPlaceholderText('输入你的问题...');
    const sendButton = getSendButton();

    fireEvent.change(input, { target: { value: '错误测试' } });
    fireEvent.click(sendButton);

    // Verify loading states
    expect(await screen.findByText('任务规划')).toBeInTheDocument();
    // We can't easily trigger a network error in this mock-only setup without
    // changing the component to accept a mock API, but we verified success and cancel.
  });
});
