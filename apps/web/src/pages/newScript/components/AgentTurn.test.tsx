import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AgentTurnView } from '@/api/agent';
import { AgentTurn } from './AgentTurn';

const baseTurn: AgentTurnView = {
  id: 'run-1',
  status: 'completed',
  kind: 'generate',
  activities: [
    {
      id: 'thinking-1',
      type: 'thinking',
      status: 'completed',
      text: '正在检查已接受的事件计划'
    },
    {
      id: 'tool-1',
      type: 'tool',
      status: 'completed',
      name: 'propose_scene_plan',
      summary: '场景计划已生成'
    }
  ],
  createdAt: '2026-07-16T00:00:00.000Z'
};

describe('AgentTurn', () => {
  it('keeps a completed turn collapsed and labels it as completed', () => {
    render(<AgentTurn turn={baseTurn} />);

    const toggle = screen.getByRole('button', { name: '执行过程，已完成 2 步' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('已完成 2 步')).toBeInTheDocument();
    expect(screen.queryByText('场景计划已生成')).not.toBeInTheDocument();
  });

  it('keeps a failed turn expanded and never labels it as completed', () => {
    const failedTurn: AgentTurnView = {
      ...baseTurn,
      status: 'failed',
      activities: [
        baseTurn.activities[0]!,
        {
          id: 'tool-1',
          type: 'tool',
          status: 'failed',
          name: 'compile_replay_runtime',
          summary: '运行时编译失败'
        }
      ]
    };

    render(<AgentTurn turn={failedTurn} />);

    const toggle = screen.getByRole('button', { name: '执行过程，执行失败 2 步' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('执行失败 · 2 步')).toBeInTheDocument();
    expect(screen.getByText('运行时编译失败')).toBeInTheDocument();
    expect(screen.queryByText(/已完成/)).not.toBeInTheDocument();
  });

  it('shows an actionable message when the model is not configured', () => {
    render(
      <AgentTurn
        turn={{
          ...baseTurn,
          status: 'failed',
          activities: [{
            id: 'diagnostic-1-1',
            type: 'diagnostic',
            status: 'failed',
            code: 'MODEL_NOT_CONFIGURED',
            summary: 'Model is not configured'
          }]
        }}
      />
    );

    expect(
      screen.getByText('尚未配置模型，请先在顶部完成模型配置')
    ).toBeInTheDocument();
  });
});
