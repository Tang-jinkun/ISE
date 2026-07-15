import React from 'react';
import { EditorPanel, SectionTitle, FormItem } from './EditorPanel';
import { Input } from '@/components/ui/input';

export interface CameraAlongDetailProps {
  data: {
    cameraAltitude: number;
    start: number;
    finish: number;
  };
  onUpdate: (data: Partial<CameraAlongDetailProps['data']>) => void;
  onClose?: () => void;
}

export function CameraAlongDetail({ data, onUpdate, onClose }: CameraAlongDetailProps) {
  const handleChange = (key: keyof CameraAlongDetailProps['data'], value: number) => {
    onUpdate({ [key]: value });
  };

  return (
    <EditorPanel title="视角跟随" onClose={onClose}>
      <SectionTitle>基础</SectionTitle>
      <FormItem label="相机角度">
        <Input
          type="number"
          value={data.cameraAltitude}
          onChange={(e) => handleChange('cameraAltitude', parseFloat(e.target.value))}
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
