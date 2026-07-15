import { Input } from '@/components/ui/input';
import { message } from '@/components/ui/message';
import { useSceneStore, type SelectedClip } from '@/stores/sceneStore';
import type { SceneTrackItem } from '@ise/runtime-contracts';
import { Layers } from 'lucide-react';

function Field({
  label,
  value,
  onCommit,
  type = 'text',
}: {
  label: string;
  value: string | number;
  onCommit?: (value: string) => void;
  type?: 'text' | 'number';
}) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Input
        key={String(value)}
        type={type}
        defaultValue={value}
        readOnly={!onCommit}
        onBlur={(event) => onCommit?.(event.currentTarget.value)}
        className="h-8 rounded-lg border-border bg-background text-xs"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onCommit,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onCommit: (value: string) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onCommit(event.currentTarget.value)}
        className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground"
      >
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onCommit,
}: {
  label: string;
  checked: boolean;
  onCommit: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onCommit(event.currentTarget.checked)} />
    </label>
  );
}

function numberValue(rawValue: string) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) throw new Error('invalid number');
  return value;
}

export function PropertyPanel() {
  const selectedClip = useSceneStore((state) => state.selectedClip);
  const updateSelectedClip = useSceneStore((state) => state.updateSelectedClip);
  const updateTrackItem = useSceneStore((state) => state.updateTrackItem);

  const commitItem = (updates: Partial<SceneTrackItem>) => {
    if (!selectedClip) return false;
    try {
      updateTrackItem(selectedClip.trackId, selectedClip.id, updates);
      updateSelectedClip(updates as Partial<SelectedClip>);
      return true;
    } catch {
      message.error('修改不符合当前轨道约束。');
      return false;
    }
  };

  const commitTime = (field: 'startMs' | 'durationMs', rawValue: string) => {
    if (!selectedClip) return;
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < 0 || (field === 'durationMs' && value < 1)) {
      message.error('请输入有效的毫秒整数。');
      return;
    }
    if (commitItem({ [field]: value })) {
      updateSelectedClip({
        ...(field === 'startMs' ? { start: value } : { width: value }),
      });
    }
  };

  const commitParams = (updates: Record<string, unknown>) => {
    if (!selectedClip) return;
    const params = {
      ...(selectedClip.params as Record<string, unknown>),
      ...updates,
    };
    commitItem({ params } as Partial<SceneTrackItem>);
  };

  const commitLayout = (updates: Record<string, unknown>) => {
    if (!selectedClip) return;
    const params = selectedClip.params as Record<string, unknown>;
    commitParams({
      layout: {
        ...(params.layout as Record<string, unknown>),
        ...updates,
      },
    });
  };

  const renderTypeFields = () => {
    if (!selectedClip) return null;
    const params = selectedClip.params as Record<string, any>;
    switch (selectedClip.trackType) {
      case 'subtitle':
        return (
          <>
            <Field label="字幕文本" value={params.text ?? ''} onCommit={(value) => commitParams({ text: value })} />
            <div className="grid grid-cols-2 gap-2">
              <SelectField label="位置" value={params.position ?? 'bottom'} options={['top', 'bottom']} onCommit={(value) => commitParams({ position: value })} />
              <Field label="最大宽度 (%)" type="number" value={params.maxWidthPct ?? 70} onCommit={(value) => commitParams({ maxWidthPct: numberValue(value) })} />
            </div>
          </>
        );
      case 'image':
      case 'video':
        return (
          <>
            <Field label="素材 ID" value={selectedClip.assetId ?? ''} onCommit={(value) => commitItem({ assetId: value } as Partial<SceneTrackItem>)} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="X (%)" type="number" value={params.layout?.xPct ?? 0} onCommit={(value) => commitLayout({ xPct: numberValue(value) })} />
              <Field label="Y (%)" type="number" value={params.layout?.yPct ?? 0} onCommit={(value) => commitLayout({ yPct: numberValue(value) })} />
              <Field label="宽度 (%)" type="number" value={params.layout?.widthPct ?? 30} onCommit={(value) => commitLayout({ widthPct: numberValue(value) })} />
              <Field label="高度 (%)" type="number" value={params.layout?.heightPct ?? 30} onCommit={(value) => commitLayout({ heightPct: numberValue(value) })} />
              <Field label="层级" type="number" value={params.layout?.zIndex ?? 1} onCommit={(value) => commitLayout({ zIndex: numberValue(value) })} />
              <Field label="透明度" type="number" value={params.layout?.opacity ?? 1} onCommit={(value) => commitLayout({ opacity: numberValue(value) })} />
            </div>
            <SelectField label="填充方式" value={params.layout?.fit ?? 'contain'} options={['contain', 'cover']} onCommit={(value) => commitLayout({ fit: value })} />
            {selectedClip.trackType === 'image' ? (
              <div className="grid grid-cols-2 gap-2">
                <SelectField label="进入" value={params.enter ?? 'none'} options={['none', 'fade']} onCommit={(value) => commitParams({ enter: value })} />
                <SelectField label="退出" value={params.exit ?? 'none'} options={['none', 'fade']} onCommit={(value) => commitParams({ exit: value })} />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="音量" type="number" value={params.volume ?? 1} onCommit={(value) => commitParams({ volume: numberValue(value) })} />
                  <Field label="播放速率" type="number" value={params.playbackRate ?? 1} onCommit={(value) => commitParams({ playbackRate: numberValue(value) })} />
                </div>
                <ToggleField label="循环播放" checked={Boolean(params.loop)} onCommit={(value) => commitParams({ loop: value })} />
              </>
            )}
          </>
        );
      case 'marker':
        return (
          <>
            <Field label="标签" value={params.label ?? ''} onCommit={(value) => commitParams({ label: value })} />
            <Field label="颜色" value={params.color ?? ''} onCommit={(value) => commitParams({ color: value })} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="经度" type="number" value={params.coordinates?.[0] ?? 0} onCommit={(value) => commitParams({ coordinates: [numberValue(value), params.coordinates?.[1] ?? 0] })} />
              <Field label="纬度" type="number" value={params.coordinates?.[1] ?? 0} onCommit={(value) => commitParams({ coordinates: [params.coordinates?.[0] ?? 0, numberValue(value)] })} />
            </div>
          </>
        );
      case 'geojson':
        return (
          <>
            <Field label="素材 ID" value={selectedClip.assetId ?? ''} onCommit={(value) => commitItem({ assetId: value } as Partial<SceneTrackItem>)} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="线颜色" value={params.lineColor ?? ''} onCommit={(value) => commitParams({ lineColor: value })} />
              <Field label="线宽" type="number" value={params.lineWidth ?? 0} onCommit={(value) => commitParams({ lineWidth: numberValue(value) })} />
              <Field label="填充颜色" value={params.fillColor ?? ''} onCommit={(value) => commitParams({ fillColor: value })} />
              <Field label="填充透明度" type="number" value={params.fillOpacity ?? 0} onCommit={(value) => commitParams({ fillOpacity: numberValue(value) })} />
              <Field label="点颜色" value={params.circleColor ?? ''} onCommit={(value) => commitParams({ circleColor: value })} />
              <Field label="点半径" type="number" value={params.circleRadius ?? 0} onCommit={(value) => commitParams({ circleRadius: numberValue(value) })} />
            </div>
            <ToggleField label="结束后保留" checked={Boolean(params.keepAfterEnd)} onCommit={(value) => commitParams({ keepAfterEnd: value })} />
          </>
        );
      case 'camera':
        return (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="中心经度" type="number" value={params.center?.[0] ?? 0} onCommit={(value) => commitParams({ center: [numberValue(value), params.center?.[1] ?? 0] })} />
              <Field label="中心纬度" type="number" value={params.center?.[1] ?? 0} onCommit={(value) => commitParams({ center: [params.center?.[0] ?? 0, numberValue(value)] })} />
              <Field label="缩放" type="number" value={params.zoom ?? 0} onCommit={(value) => commitParams({ zoom: numberValue(value) })} />
              <Field label="俯仰" type="number" value={params.pitch ?? 0} onCommit={(value) => commitParams({ pitch: numberValue(value) })} />
              <Field label="航向" type="number" value={params.bearing ?? 0} onCommit={(value) => commitParams({ bearing: numberValue(value) })} />
            </div>
            <SelectField label="缓动" value={params.easing ?? 'linear'} options={['linear', 'easeInOut']} onCommit={(value) => commitParams({ easing: value })} />
          </>
        );
      case 'model':
        return (
          <>
            <Field label="动作" value={params.action ?? ''} />
            <Field label="实体 ID" value={params.entityId ?? ''} onCommit={(value) => commitParams({ entityId: value })} />
            {params.action === 'model.follow_path' && (
              <Field label="航迹素材 ID" value={params.trajectoryAssetId ?? ''} onCommit={(value) => commitParams({ trajectoryAssetId: value })} />
            )}
            {params.action === 'model.set_state' && (
              <SelectField label="状态" value={params.state ?? 'normal'} options={['normal', 'warning', 'disabled', 'hidden']} onCommit={(value) => commitParams({ state: value })} />
            )}
          </>
        );
      default:
        return null;
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
              <Field label="开始时间 (ms)" type="number" value={selectedClip.startMs ?? selectedClip.start} onCommit={(value) => commitTime('startMs', value)} />
              <Field label="持续时间 (ms)" type="number" value={selectedClip.durationMs ?? selectedClip.width} onCommit={(value) => commitTime('durationMs', value)} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[11px] font-medium text-muted-foreground">轨道参数</div>
            {renderTypeFields()}
          </div>

          <div className="space-y-2">
            <div className="text-[11px] font-medium text-muted-foreground">溯源</div>
            <Field label="事件单元" value={typeof selectedClip.eventUnitId === 'string' ? selectedClip.eventUnitId : ''} />
            <Field label="证据引用" value={Array.isArray(selectedClip.evidenceRefs) ? selectedClip.evidenceRefs.join(', ') : ''} />
          </div>
        </div>
      )}
    </aside>
  );
}
