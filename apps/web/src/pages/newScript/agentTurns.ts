import type { AgentEvent, AgentTurnActivity, AgentTurnView } from '@/api/agent';

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  return typeof data[key] === 'string' && data[key].length > 0 ? data[key] : undefined;
}

function numberField(data: Record<string, unknown>, key: string): number | undefined {
  return typeof data[key] === 'number' && Number.isFinite(data[key]) ? data[key] : undefined;
}

function settleThinking(activities: AgentTurnActivity[]) {
  const last = activities.at(-1);
  if (last?.type === 'thinking' && last.status === 'running') last.status = 'completed';
}

function applyActivity(activities: AgentTurnActivity[], event: AgentEvent) {
  if (event.type === 'model.streaming') {
    const text = stringField(event.data, 'text');
    if (!text) return;
    const last = activities.at(-1);
    if (last?.type === 'thinking' && last.status === 'running') last.text = `${last.text ?? ''}${text}`;
    else activities.push({
      id: `thinking-${activities.filter((item) => item.type === 'thinking').length + 1}`,
      type: 'thinking',
      status: 'running',
      text,
    });
    return;
  }
  if (event.type === 'tool.started') {
    settleThinking(activities);
    const id = stringField(event.data, 'toolCallId') ?? `tool-${event.id}`;
    if (!activities.some((item) => item.type === 'tool' && item.id === id)) {
      activities.push({
        id,
        type: 'tool',
        status: 'running',
        name: stringField(event.data, 'toolName') ?? 'tool',
        ...(stringField(event.data, 'summary') ? { summary: stringField(event.data, 'summary') } : {}),
      });
    }
    return;
  }
  if (['tool.progress', 'tool.completed', 'tool.failed'].includes(event.type)) {
    settleThinking(activities);
    const id = stringField(event.data, 'toolCallId') ?? `tool-${event.id}`;
    let tool = activities.find((item) => item.type === 'tool' && item.id === id);
    if (!tool) {
      tool = { id, type: 'tool', status: 'running', name: stringField(event.data, 'toolName') ?? 'tool' };
      activities.push(tool);
    }
    tool.status = event.type === 'tool.failed' ? 'failed' : event.type === 'tool.completed' ? 'completed' : 'running';
    tool.name = stringField(event.data, 'toolName') ?? tool.name;
    tool.summary = stringField(event.data, 'summary') ?? stringField(event.data, 'message') ?? tool.summary;
    tool.percentage = numberField(event.data, 'percentage') ?? tool.percentage;
    return;
  }
  if (event.type === 'diagnostic.created') {
    settleThinking(activities);
    activities.push({
      id: `diagnostic-${event.id}`,
      type: 'diagnostic',
      status: stringField(event.data, 'severity') === 'error' ? 'failed' : 'completed',
      summary: stringField(event.data, 'summary') ?? '智能体执行状态已更新',
    });
  }
}

export function applyAgentEventToTurns(
  turns: readonly AgentTurnView[],
  event: AgentEvent,
): AgentTurnView[] {
  const runId = stringField(event.data, 'runId');
  if (!runId) return [...turns];
  const next = turns.map((turn) => ({ ...turn, activities: turn.activities.map((item) => ({ ...item })) }));
  let turn = next.find((item) => item.id === runId);
  if (!turn) {
    turn = {
      id: runId,
      status: event.type === 'run.started' ? 'running' : 'queued',
      kind: 'generate',
      activities: [],
      createdAt: new Date().toISOString(),
    };
    next.push(turn);
  }
  applyActivity(turn.activities, event);
  if (event.type === 'run.started') turn.status = 'running';
  if (event.type === 'run.completed') {
    settleThinking(turn.activities);
    turn.status = 'completed';
    const finalAnswer = stringField(event.data, 'finalAnswer');
    if (finalAnswer) {
      turn.assistantMessage = {
        id: `${runId}:assistant-live`,
        role: 'assistant',
        content: finalAnswer,
        createdAt: new Date().toISOString(),
      };
      turn.outcome = { status: 'completed', finalAnswer };
    }
  }
  if (event.type === 'run.failed') {
    settleThinking(turn.activities);
    turn.status = event.data.status === 'cancelled' ? 'cancelled' : 'failed';
  }
  return next;
}
