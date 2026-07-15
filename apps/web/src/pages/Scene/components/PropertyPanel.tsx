import { Input } from '@/components/ui/input';
import { message } from '@/components/ui/message';
import { useSceneStore } from '@/stores/sceneStore';
import { Layers } from 'lucide-react';

function Field({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string | number;
  onCommit?: (value: string) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Input
        key={String(value)}
        defaultValue={value}
        readOnly={!onCommit}
        onBlur={(event) => onCommit?.(event.currentTarget.value)}
        className="h-8 rounded-lg border-border bg-background text-xs"
      />
    </label>
  );
}

export function PropertyPanel() {
  const selectedClip = useSceneStore((state) => state.selectedClip);
  const updateSelectedClip = useSceneStore((state) => state.updateSelectedClip);
  const updateTrackItem = useSceneStore((state) => state.updateTrackItem);

  const commitTime = (field: 'startMs' | 'durationMs', rawValue: string) => {
    if (!selectedClip) return;
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < 0 || (field === 'durationMs' && value < 1)) {
      message.error('请输入有效的毫秒整数。');
      return;
    }
    try {
      updateTrackItem(selectedClip.trackId, selectedClip.id, { [field]: value });
      updateSelectedClip({
        [field]: value,
        ...(field === 'startMs' ? { start: value } : { width: value }),
      });
    } catch {
      message.error('修改超出场景时长或不符合轨道约束。');
    }
  };

  return (
    <aside className="flex w-80 flex-col border-l border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-xs text-muted-foreground">
        <Layers className="h-3.5 w-3.5 text-cyan-400" />
        <span className="truncate">属性编辑</span>
      </div>

      {!selectedClip ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-muted-foreground">
          请选择时间轴中的片段。
        </div>
      ) : (
        <div className="custom-scrollbar flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <div className="space-y-2">
            <div className="text-[11px] font-medium text-muted-foreground">基础属性</div>
            <Field label="片段 ID" value={selectedClip.id} />
            <Field label="轨道类型" value={selectedClip.trackType} />
            <div className="grid grid-cols-2 gap-2">
              <Field
                label="开始时间 (ms)"
                value={selectedClip.startMs ?? selectedClip.start}
                onCommit={(value) => commitTime('startMs', value)}
              />
              <Field
                label="持续时间 (ms)"
                value={selectedClip.durationMs ?? selectedClip.width}
                onCommit={(value) => commitTime('durationMs', value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[11px] font-medium text-muted-foreground">溯源</div>
            <Field
              label="事件单元"
              value={typeof selectedClip.eventUnitId === 'string' ? selectedClip.eventUnitId : ''}
            />
            <Field
              label="证据引用"
              value={Array.isArray(selectedClip.evidenceRefs) ? selectedClip.evidenceRefs.join(', ') : ''}
            />
          </div>
        </div>
      )}
    </aside>
  );
}
