import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceState } from '../workspaceStage';
import { SceneWorkspace } from './SceneWorkspace';

const hiddenState: WorkspaceState = {
  visible: false,
  defaultTab: null,
  availableTabs: [],
  failed: false
};

const visibleState: WorkspaceState = {
  visible: true,
  defaultTab: 'event-plan',
  availableTabs: ['event-plan', 'narration'],
  failed: false
};

describe('SceneWorkspace', () => {
  it('renders no workspace before an inspectable artifact exists', () => {
    const { container } = render(
      <SceneWorkspace
        state={hiddenState}
        activeTab={null}
        onTabChange={vi.fn()}
        widthPct={42}
        collapsed={false}
        onCollapsedChange={vi.fn()}
        panels={{}}
      />
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('renders only tabs backed by an available panel', () => {
    render(
      <SceneWorkspace
        state={visibleState}
        activeTab="event-plan"
        onTabChange={vi.fn()}
        widthPct={42}
        collapsed={false}
        onCollapsedChange={vi.fn()}
        panels={{
          'event-plan': <div>事件计划审核内容</div>
        }}
      />
    );

    expect(screen.getByRole('complementary', { name: '场景工作台' })).toHaveStyle({
      width: '42%'
    });
    expect(screen.getByRole('tab', { name: '事件计划' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '字幕脚本' })).not.toBeInTheDocument();
    expect(screen.getByText('事件计划审核内容')).toBeInTheDocument();
  });

  it('changes tabs and exposes a compact collapse control', () => {
    const onTabChange = vi.fn();
    const onCollapsedChange = vi.fn();
    render(
      <SceneWorkspace
        state={visibleState}
        activeTab="event-plan"
        onTabChange={onTabChange}
        widthPct={42}
        collapsed={false}
        onCollapsedChange={onCollapsedChange}
        panels={{
          'event-plan': <div>事件计划审核内容</div>,
          narration: <div>字幕脚本内容</div>
        }}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: '字幕脚本' }));
    expect(onTabChange).toHaveBeenCalledWith('narration');
    fireEvent.click(screen.getByRole('button', { name: '收起场景工作台' }));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it('retains the current panel and marks a failed downstream stage', () => {
    render(
      <SceneWorkspace
        state={{ ...visibleState, failed: true }}
        activeTab="event-plan"
        onTabChange={vi.fn()}
        widthPct={42}
        collapsed={false}
        onCollapsedChange={vi.fn()}
        panels={{
          'event-plan': <div>仍可检查的事件计划</div>
        }}
      />
    );

    expect(screen.getByText('生成受阻')).toBeInTheDocument();
    expect(screen.getByText('仍可检查的事件计划')).toBeInTheDocument();
  });

  it('renders a narrow reopen control while collapsed', () => {
    render(
      <SceneWorkspace
        state={visibleState}
        activeTab="event-plan"
        onTabChange={vi.fn()}
        widthPct={42}
        collapsed
        onCollapsedChange={vi.fn()}
        panels={{
          'event-plan': <div>事件计划审核内容</div>
        }}
      />
    );

    expect(screen.getByRole('complementary', { name: '场景工作台' })).toHaveStyle({
      width: '44px'
    });
    expect(screen.getByRole('button', { name: '展开场景工作台' })).toBeInTheDocument();
    expect(screen.queryByText('事件计划审核内容')).not.toBeInTheDocument();
  });
});
