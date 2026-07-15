import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Activity, MapPin, MoveRight, Sparkles, Timer } from 'lucide-react';
import { EditorPanel, FormItem, SectionTitle } from './EditorPanel';

export interface MapEaseDetailProps {
  data: {
    lon: number;
    lat: number;
    zoom: number;
    pitch: number;
    bearing: number;
    start: number;
    finish: number;
  };
  onUpdate: (data: Partial<MapEaseDetailProps['data']>) => void;
  onGetMapInfo?: () => void;
  onClose?: () => void;
}

export function MapEaseDetail({
  data,
  onUpdate,
  onGetMapInfo,
  onClose
}: MapEaseDetailProps) {
  const handleChange = (
    key: keyof MapEaseDetailProps['data'],
    value: number
  ) => {
    onUpdate({ [key]: value });
  };

  return (
    <EditorPanel
      title="视角转移"
      onClose={onClose}
      headerContent={
        onGetMapInfo && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onGetMapInfo}
            title="获取当前地图信息"
          >
            <MapPin className="h-4 w-4" />
          </Button>
        )
      }
    >
      <SectionTitle>基础</SectionTitle>
      <FormItem label="目标经度">
        <Input
          type="number"
          value={data.lon}
          onChange={(e) => handleChange('lon', parseFloat(e.target.value))}
          className="h-8 text-xs"
        />
      </FormItem>
      <FormItem label="目标纬度">
        <Input
          type="number"
          value={data.lat}
          onChange={(e) => handleChange('lat', parseFloat(e.target.value))}
          className="h-8 text-xs"
        />
      </FormItem>
      <FormItem label="目标层级">
        <Input
          type="number"
          value={data.zoom}
          onChange={(e) => handleChange('zoom', parseFloat(e.target.value))}
          className="h-8 text-xs"
        />
      </FormItem>
      <FormItem label="目标倾斜角">
        <Input
          type="number"
          value={data.pitch}
          onChange={(e) => handleChange('pitch', parseFloat(e.target.value))}
          className="h-8 text-xs"
        />
      </FormItem>
      <FormItem label="目标方位角">
        <Input
          type="number"
          value={data.bearing}
          onChange={(e) => handleChange('bearing', parseFloat(e.target.value))}
          className="h-8 text-xs"
        />
      </FormItem>

      <SectionTitle className="mt-4">时长</SectionTitle>
      <FormItem label="起始时间">
        <div className="relative">
          <Input
            type="number"
            value={data.start}
            onChange={(e) => handleChange('start', parseFloat(e.target.value))}
            className="h-8 text-xs pr-8"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            ms
          </span>
        </div>
      </FormItem>
      <FormItem label="终止时间">
        <div className="relative">
          <Input
            type="number"
            value={data.finish}
            onChange={(e) => handleChange('finish', parseFloat(e.target.value))}
            className="h-8 text-xs pr-8"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            ms
          </span>
        </div>
      </FormItem>
    </EditorPanel>
  );
}

// --- Injected Transition Logic ---

export interface TransitionDetailData {
  lon: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
  start: number;
  finish: number;
}

export interface TransitionDetailProps {
  data: Partial<TransitionDetailData>;
  onUpdate: (data: Partial<TransitionDetailData>) => void;
  onSave: () => void;
}

export const DEFAULT_TRANSITION_DATA: TransitionDetailData = {
  lon: 114.3055,
  lat: 30.5928,
  zoom: 12,
  pitch: 45,
  bearing: 0,
  start: 0,
  finish: 2000
};

export function TransitionDetail({
  data = DEFAULT_TRANSITION_DATA,
  onUpdate,
  onSave
}: TransitionDetailProps) {
  const handleChange = (
    key: keyof TransitionDetailData,
    value: string | number
  ) => {
    onUpdate({ [key]: typeof value === 'string' ? parseFloat(value) : value });
  };

  const FormField = ({
    label,
    icon: Icon,
    value,
    onChange,
    type = 'number',
    unit
  }: any) => (
    <div className="space-y-1.5">
      <Label className="text-[9px] font-black text-muted-foreground uppercase flex items-center gap-1.5 tracking-wider">
        <Icon className="w-3 h-3 text-blue-500/70" />
        {label}
      </Label>
      <div className="relative">
        <Input
          type={type}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-[11px] bg-blue-500/5 border-none font-mono focus-visible:ring-blue-500/30 pr-8"
        />
        {unit && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground font-mono">
            {unit}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <Card className="border border-blue-500/20 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm shadow-sm overflow-hidden rounded-xl w-full my-2">
      <CardContent className="p-4 space-y-4 relative">
        <div className="flex items-center justify-between border-b border-blue-500/10 pb-2">
          <span className="text-[10px] font-black uppercase tracking-[0.1em] text-blue-600 flex items-center gap-1.5">
            <MoveRight className="w-3.5 h-3.5" />
            视角转移
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <FormField
            label="经度 (Lon)"
            icon={MapPin}
            value={data?.lon}
            onChange={(v: any) => handleChange('lon', v)}
          />
          <FormField
            label="纬度 (Lat)"
            icon={MapPin}
            value={data?.lat}
            onChange={(v: any) => handleChange('lat', v)}
          />
          <FormField
            label="缩放 (Zoom)"
            icon={Sparkles}
            value={data?.zoom}
            onChange={(v: any) => handleChange('zoom', v)}
          />
          <FormField
            label="倾斜 (Pitch)"
            icon={Activity}
            value={data?.pitch}
            onChange={(v: any) => handleChange('pitch', v)}
            unit="°"
          />
          <FormField
            label="方位 (Bearing)"
            icon={Activity}
            value={data?.bearing}
            onChange={(v: any) => handleChange('bearing', v)}
            unit="°"
          />
        </div>

        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-blue-500/5">
          <FormField
            label="起始时间"
            icon={Timer}
            value={data?.start}
            onChange={(v: any) => handleChange('start', v)}
            unit="ms"
          />
          <FormField
            label="终止时间"
            icon={Timer}
            value={data?.finish}
            onChange={(v: any) => handleChange('finish', v)}
            unit="ms"
          />
        </div>

        <Button
          onClick={onSave}
          size="sm"
          className="w-full h-8 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase rounded-lg shadow-md shadow-blue-500/20 transition-all active:scale-[0.98]"
        >
          保存转场参数
        </Button>
      </CardContent>
    </Card>
  );
}
