import React from 'react';
import { EditorPanel, SectionTitle, FormItem } from './EditorPanel';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select } from '@/components/ui/select';

export interface ImageRasterDetailProps {
  data: {
    paint: {
      imageRasterOpacity: number;
      imageRasterContrast: number;
      imageRasterSaturation: number;
      imagerasterMinBright: number;
      imagerasterMaxBright: number;
      imagerasterResamling: string;
      imagerasterFadeDuration: number;
    };
    keepLive: boolean;
    start: number;
    finish: number;
  };
  onUpdate: (data: Partial<ImageRasterDetailProps['data']>) => void;
  onClose?: () => void;
}

export function ImageRasterDetail({ data, onUpdate, onClose }: ImageRasterDetailProps) {
  const handleChange = (key: string, value: any) => {
    if (key.startsWith('paint.')) {
      const paintKey = key.split('.')[1];
      onUpdate({ ...data, paint: { ...data.paint, [paintKey]: value } });
    } else {
      onUpdate({ ...data, [key]: value });
    }
  };

  return (
    <EditorPanel title="栅格" onClose={onClose}>
      <SectionTitle>图层</SectionTitle>

      <FormItem label="不透明度">
        <div className="flex gap-3 items-center">
          <Slider
            value={[data.paint.imageRasterOpacity]}
            min={0}
            max={1}
            step={0.01}
            onValueChange={([v]) => handleChange('paint.imageRasterOpacity', v)}
            className="flex-1"
          />
          <Input
            type="number"
            value={data.paint.imageRasterOpacity}
            onChange={(e) => handleChange('paint.imageRasterOpacity', parseFloat(e.target.value))}
            className="w-16 h-8 text-xs"
          />
        </div>
      </FormItem>

      <FormItem label="对比度">
        <div className="flex gap-3 items-center">
          <Slider
            value={[data.paint.imageRasterContrast]}
            min={-1}
            max={1}
            step={0.1}
            onValueChange={([v]) => handleChange('paint.imageRasterContrast', v)}
            className="flex-1"
          />
          <Input
            type="number"
            value={data.paint.imageRasterContrast}
            onChange={(e) => handleChange('paint.imageRasterContrast', parseFloat(e.target.value))}
            className="w-16 h-8 text-xs"
          />
        </div>
      </FormItem>

      <FormItem label="饱和度">
        <div className="flex gap-3 items-center">
          <Slider
            value={[data.paint.imageRasterSaturation]}
            min={-1}
            max={1}
            step={0.1}
            onValueChange={([v]) => handleChange('paint.imageRasterSaturation', v)}
            className="flex-1"
          />
          <Input
            type="number"
            value={data.paint.imageRasterSaturation}
            onChange={(e) => handleChange('paint.imageRasterSaturation', parseFloat(e.target.value))}
            className="w-16 h-8 text-xs"
          />
        </div>
      </FormItem>

      <FormItem label="亮度大小">
        <div className="flex gap-2">
           <Input
            type="number"
            value={data.paint.imagerasterMinBright}
            min={0}
            max={1}
            onChange={(e) => handleChange('paint.imagerasterMinBright', parseFloat(e.target.value))}
            className="h-8 text-xs"
          />
          <Input
            type="number"
            value={data.paint.imagerasterMaxBright}
            min={0}
            max={1}
            onChange={(e) => handleChange('paint.imagerasterMaxBright', parseFloat(e.target.value))}
            className="h-8 text-xs"
          />
        </div>
      </FormItem>

      <FormItem label="重采样方式">
        <Select
          value={data.paint.imagerasterResamling}
          onChange={(e) => handleChange('paint.imagerasterResamling', e.target.value)}
        >
          <option value="linear">linear</option>
          <option value="nearest">nearest</option>
        </Select>
      </FormItem>

      <FormItem label="渐隐时间">
        <div className="relative">
          <Input
            type="number"
            value={data.paint.imagerasterFadeDuration}
            onChange={(e) => handleChange('paint.imagerasterFadeDuration', parseFloat(e.target.value))}
            className="h-8 text-xs pr-8"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">ms</span>
        </div>
      </FormItem>

      <SectionTitle className="mt-4">基础</SectionTitle>
      <FormItem label="是否失活" className="flex items-center justify-between">
        <Switch
          checked={data.keepLive}
          onCheckedChange={(v) => handleChange('keepLive', v)}
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
