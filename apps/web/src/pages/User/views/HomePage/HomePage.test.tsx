import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from './index';

const mocks = vi.hoisted(() => ({
  createBlankScene: vi.fn(),
  createScript: vi.fn(),
  deleteScene: vi.fn(),
  deleteScript: vi.fn(),
  listScenes: vi.fn(),
  listScripts: vi.fn(),
  navigate: vi.fn()
}));

vi.mock('@/api/scene', () => ({
  createBlankScene: mocks.createBlankScene,
  deleteScene: mocks.deleteScene,
  listScenes: mocks.listScenes
}));

vi.mock('@/api/script', () => ({
  createScript: mocks.createScript,
  deleteScript: mocks.deleteScript,
  listScripts: mocks.listScripts
}));

vi.mock('@/components/ui/message', () => ({
  message: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn()
  }
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate
  };
});

describe('HomePage script routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listScripts.mockResolvedValue({ data: [] });
    mocks.listScenes.mockResolvedValue({ data: [] });
    mocks.createScript.mockResolvedValue({ data: { id: 'script-new' } });
  });

  it('opens a newly created script in the new workspace', async () => {
    render(<HomePage />);

    fireEvent.click(screen.getByRole('button', { name: /新建脚本项目/ }));
    fireEvent.change(screen.getByPlaceholderText('未命名脚本项目'), {
      target: { value: '空战复盘' }
    });
    fireEvent.click(screen.getByRole('button', { name: '确定创建' }));

    await waitFor(() =>
      expect(mocks.createScript).toHaveBeenCalledWith({ title: '空战复盘' })
    );
    expect(mocks.navigate).toHaveBeenCalledWith(
      '/new-script?projectId=script-new'
    );
  });

  it('opens an existing script directly in the new workspace', async () => {
    mocks.listScripts.mockResolvedValue({
      data: [
        {
          id: 'script-existing',
          title: 'Existing script',
          updatedAt: '2026-07-16T00:00:00.000Z'
        }
      ]
    });

    render(<HomePage />);
    const title = await screen.findByText('Existing script');
    fireEvent.click(title.closest('button')!);

    expect(mocks.navigate).toHaveBeenCalledWith(
      '/new-script?projectId=script-existing'
    );
    expect(
      screen.queryByRole('heading', { name: '进入脚本工作台' })
    ).not.toBeInTheDocument();
  });
});
