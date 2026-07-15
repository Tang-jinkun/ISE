import React from 'react';
import { EditorPanel, SectionTitle, FormItem } from './EditorPanel';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MapPin } from 'lucide-react';
export interface CameraRotateDetailProps {
  data: {
    lon: number;
    lat: number;
    zoom: number;
    pitch: number;
    start: number;
    finish: number;
  };
  onUpdate: (data: Partial<CameraRotateDetailProps['data']>) => void;
  onGetMapInfo?: () => void;
  onClose?: () => void;
}

export function CameraRotateDetail({ data, onUpdate, onGetMapInfo, onClose }: CameraRotateDetailProps) {
  const handleChange = (key: keyof CameraRotateDetailProps['data'], value: number) => {
    onUpdate({ [key]: value });
  };

  return (
    <EditorPanel
      title="视角旋转"
      onClose={onClose}
      headerContent={
        onGetMapInfo && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onGetMapInfo} title="获取当前地图信息">
            <MapPin className="h-4 w-4" />
          </Button>
        )
      }
    >
      <SectionTitle>基础</SectionTitle>
      <FormItem label="倾斜角度">
        <Input
          type="number"
          value={data.pitch}
          onChange={(e) => handleChange('pitch', parseFloat(e.target.value))}
          className="h-8 text-xs"
        />
      </FormItem>

      {/* Hidden fields but might be useful to show if needed, based on Vue code they seem to be part of 'form' but only pitch is shown in "基础" section explicitly in the template I read?
          Wait, re-reading Vue code:
          Line 40: itemTitle 倾斜角度 -> input form.pitch.
          I don't see lon/lat/zoom inputs in the template I read for CameraRotateDetail (batch 1).
          Ah, let me re-check.
          Batch 1 Read Output for CarmeraRotateDetail/index.vue:
          Lines 38-47: Only Pitch is shown in "partContent".
          But onGetMapInfo fills lon, lat, zoom, pitch.
          So they might be hidden or I missed them.
          Wait, looking at MapEaseDetail (Batch 2), it has lon/lat/zoom inputs.
          CameraRotateDetail seems to only expose Pitch editing manually, but stores others?
          I will stick to what's in the template: Pitch only.
      */}

      <SectionTitle className="mt-4">时长</SectionTitle>
      <FormItem label="起始时间">
        <div className="relative">
          <Input
            type="number"
            value={data.start}
            onChange={(e) => handleChange('start', parseFloat(e.target.value))}
            className="h-8 text-xs pr-8"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">ms</span>
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
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">ms</span>
        </div>
      </FormItem>
    </EditorPanel>
  );
}
