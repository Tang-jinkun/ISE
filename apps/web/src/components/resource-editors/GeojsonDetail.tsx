import React, { useState } from 'react';
import { EditorPanel, SectionTitle, FormItem } from './EditorPanel';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

export interface GeojsonDetailProps {
  data: {
    type: string;
    animation: string;
    keepLive: boolean;
    paint?: {
      circle_opacity: number;
      circle_radius: number;
      circle_color: string;
      circle_blur: number;
      circle_stroke_width: number;
      circle_stroke_color: string;
    };
    // Added for Script page compatibility
    textSize?: number;
    textColor?: string;
    lineWidth?: number;
    lineColor?: string;
    fillColor?: string;
    fillOpacity?: number;
  };
  animationItems?: Array<{
    id: string;
    geojsonType: string;
    animationType: string;
    src: string;
    arctionName: string;
  }>;
  onUpdate: (data: Partial<GeojsonDetailProps['data']>) => void;
  onClose?: () => void;
}

export function GeojsonDetail({ data, animationItems = [], onUpdate, onClose }: GeojsonDetailProps) {
  const [activeTab, setActiveTab] = useState<'vector' | 'animation'>('vector');

  const handleChange = (key: string, value: any) => {
    if (key.startsWith('paint.')) {
      if (!data.paint) return;
      const paintKey = key.split('.')[1];
      onUpdate({ ...data, paint: { ...data.paint, [paintKey]: value } });
    } else {
      onUpdate({ ...data, [key]: value });
    }
  };

  return (
    <EditorPanel
      title="GeoJSON"
      onClose={onClose}
      headerContent={
        <div className="flex bg-muted rounded-md p-1 gap-1">
          <Button
            variant={activeTab === 'vector' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setActiveTab('vector')}
          >
            矢量
          </Button>
          <Button
            variant={activeTab === 'animation' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setActiveTab('animation')}
          >
            动效
          </Button>
        </div>
      }
    >
      {activeTab === 'vector' ? (
        <>
          <SectionTitle>基础</SectionTitle>
          <FormItem label="是否持久化存在" className="flex items-center justify-between">
            <Switch
              checked={data.keepLive}
              onCheckedChange={(v) => handleChange('keepLive', v)}
            />
          </FormItem>

          {/* Script Page Props */}
          {(data.textSize !== undefined || data.textColor !== undefined) && (
             <div className="mt-4 space-y-4">
               <SectionTitle>文本样式</SectionTitle>
               {data.textSize !== undefined && (
                 <FormItem label="大小">
                   <div className="flex gap-3 items-center">
                    <Slider
                      value={[data.textSize]}
                      min={10}
                      max={100}
                      step={1}
                      onValueChange={([v]) => handleChange('textSize', v)}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={data.textSize}
                      onChange={(e) => handleChange('textSize', parseFloat(e.target.value))}
                      className="w-16 h-8 text-xs"
                    />
                  </div>
                 </FormItem>
               )}
               {data.textColor !== undefined && (
                  <FormItem label="颜色">
                    <div className="flex gap-2">
                      <Input
                        type="color"
                        value={data.textColor}
                        onChange={(e) => handleChange('textColor', e.target.value)}
                        className="w-8 h-8 p-0 border-0"
                      />
                      <Input
                        value={data.textColor}
                        onChange={(e) => handleChange('textColor', e.target.value)}
                        className="flex-1 h-8 text-xs font-mono"
                      />
                    </div>
                  </FormItem>
               )}
             </div>
          )}

          {(data.lineWidth !== undefined || data.lineColor !== undefined) && (
             <div className="mt-4 space-y-4">
               <SectionTitle>线条样式</SectionTitle>
               {data.lineWidth !== undefined && (
                 <FormItem label="宽度">
                   <div className="flex gap-3 items-center">
                    <Slider
                      value={[data.lineWidth]}
                      min={1}
                      max={20}
                      step={1}
                      onValueChange={([v]) => handleChange('lineWidth', v)}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={data.lineWidth}
                      onChange={(e) => handleChange('lineWidth', parseFloat(e.target.value))}
                      className="w-16 h-8 text-xs"
                    />
                  </div>
                 </FormItem>
               )}
               {data.lineColor !== undefined && (
                  <FormItem label="颜色">
                    <div className="flex gap-2">
                      <Input
                        type="color"
                        value={data.lineColor}
                        onChange={(e) => handleChange('lineColor', e.target.value)}
                        className="w-8 h-8 p-0 border-0"
                      />
                      <Input
                        value={data.lineColor}
                        onChange={(e) => handleChange('lineColor', e.target.value)}
                        className="flex-1 h-8 text-xs font-mono"
                      />
                    </div>
                  </FormItem>
               )}
             </div>
          )}

          {(data.fillColor !== undefined || data.fillOpacity !== undefined) && (
             <div className="mt-4 space-y-4">
               <SectionTitle>填充样式</SectionTitle>
               {data.fillColor !== undefined && (
                  <FormItem label="颜色">
                    <div className="flex gap-2">
                      <Input
                        type="color"
                        value={data.fillColor}
                        onChange={(e) => handleChange('fillColor', e.target.value)}
                        className="w-8 h-8 p-0 border-0"
                      />
                      <Input
                        value={data.fillColor}
                        onChange={(e) => handleChange('fillColor', e.target.value)}
                        className="flex-1 h-8 text-xs font-mono"
                      />
                    </div>
                  </FormItem>
               )}
               {data.fillOpacity !== undefined && (
                 <FormItem label="透明度">
                   <div className="flex gap-3 items-center">
                    <Slider
                      value={[data.fillOpacity]}
                      min={0}
                      max={1}
                      step={0.1}
                      onValueChange={([v]) => handleChange('fillOpacity', v)}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={data.fillOpacity}
                      onChange={(e) => handleChange('fillOpacity', parseFloat(e.target.value))}
                      className="w-16 h-8 text-xs"
                    />
                  </div>
                 </FormItem>
               )}
             </div>
          )}

          {(data.type === 'circle' && data.paint) && (
            <>
              <SectionTitle className="mt-4">渲染</SectionTitle>
              <FormItem label="不透明度">
                <div className="flex gap-3 items-center">
                  <Slider
                    value={[data.paint.circle_opacity]}
                    min={0}
                    max={1}
                    step={0.1}
                    onValueChange={([v]) => handleChange('paint.circle_opacity', v)}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={data.paint.circle_opacity}
                    onChange={(e) => handleChange('paint.circle_opacity', parseFloat(e.target.value))}
                    className="w-16 h-8 text-xs"
                  />
                </div>
              </FormItem>

              <FormItem label="原点半径">
                <div className="relative">
                  <Input
                    type="number"
                    value={data.paint.circle_radius}
                    onChange={(e) => handleChange('paint.circle_radius', parseFloat(e.target.value))}
                    className="h-8 text-xs pr-8 pl-6"
                  />
                   <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">r</span>
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">px</span>
                </div>
              </FormItem>

              <FormItem label="原点颜色">
                <div className="flex gap-2">
                  <Input
                    type="color"
                    value={data.paint.circle_color}
                    onChange={(e) => handleChange('paint.circle_color', e.target.value)}
                    className="w-8 h-8 p-0 border-0"
                  />
                  <Input
                    value={data.paint.circle_color}
                    onChange={(e) => handleChange('paint.circle_color', e.target.value)}
                    className="flex-1 h-8 text-xs font-mono"
                  />
                </div>
              </FormItem>

              <FormItem label="原点虚化">
                <div className="flex gap-3 items-center">
                  <Slider
                    value={[data.paint.circle_blur]}
                    min={0}
                    max={1}
                    step={0.01}
                    onValueChange={([v]) => handleChange('paint.circle_blur', v)}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={data.paint.circle_blur}
                    onChange={(e) => handleChange('paint.circle_blur', parseFloat(e.target.value))}
                    className="w-16 h-8 text-xs"
                  />
                </div>
              </FormItem>

              <FormItem label="描边宽度">
                <div className="relative">
                  <Input
                    type="number"
                    value={data.paint.circle_stroke_width}
                    onChange={(e) => handleChange('paint.circle_stroke_width', parseFloat(e.target.value))}
                    className="h-8 text-xs pr-8 pl-6"
                  />
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">W</span>
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">px</span>
                </div>
              </FormItem>

              <FormItem label="描边颜色">
                 <div className="flex gap-2">
                  <Input
                    type="color"
                    value={data.paint.circle_stroke_color}
                    onChange={(e) => handleChange('paint.circle_stroke_color', e.target.value)}
                    className="w-8 h-8 p-0 border-0"
                  />
                  <Input
                    value={data.paint.circle_stroke_color}
                    onChange={(e) => handleChange('paint.circle_stroke_color', e.target.value)}
                    className="flex-1 h-8 text-xs font-mono"
                  />
                </div>
              </FormItem>
            </>
          )}
        </>
      ) : (
        <div className="grid grid-cols-3 gap-2 p-2">
          {animationItems
            .filter(item => item.geojsonType === data.type || item.geojsonType === 'all')
            .map(item => (
            <div
              key={item.id}
              className={cn(
                "flex flex-col items-center justify-center p-2 border rounded cursor-pointer hover:bg-muted/50",
                data.animation === item.animationType && "border-primary bg-muted"
              )}
              onClick={() => handleChange('animation', item.animationType)}
              title={item.arctionName}
            >
              <div className="h-8 w-8 relative flex items-center justify-center mb-1">
                 <img src={item.src} alt={item.arctionName} className="max-w-full max-h-full" />
              </div>
              <span className="text-[10px] text-center truncate w-full">{item.arctionName}</span>
            </div>
          ))}
        </div>
      )}
    </EditorPanel>
  );
}
