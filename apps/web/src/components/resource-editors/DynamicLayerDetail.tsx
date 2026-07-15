import React, { useState } from 'react';
import { EditorPanel, SectionTitle, FormItem } from './EditorPanel';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select } from '@/components/ui/select';

export interface DynamicLayerDetailProps {
  data: {
    draw_finish: number;
    keepLive: boolean;
    paint: {
      line_width: number;
      line_blur: number;
      line_color: string;
    };
    layout: {
      line_cap: string;
      line_join: string;
    };
    start: number;
    finish: number;
  };
  onUpdate: (data: Partial<DynamicLayerDetailProps['data']>) => void;
  onClose?: () => void;
}

const CAP_OPTIONS = [
  { label: 'butt', value: 'butt' },
  { label: 'round', value: 'round' },
  { label: 'square', value: 'square' },
];

const JOIN_OPTIONS = [
  { label: 'bevel', value: 'bevel' },
  { label: 'round', value: 'round' },
  { label: 'miter', value: 'miter' },
];

export function DynamicLayerDetail({ data, onUpdate, onClose }: DynamicLayerDetailProps) {
  const [activeTab, setActiveTab] = useState<'symbol' | 'label'>('symbol');

  const handleChange = (key: string, value: any) => {
    // Handle nested updates manually or use a deep merge utility
    // For simplicity, I'll assume flat updates or simple object spread for now
    // But here data has nested paint/layout.
    // I should helper function.
    if (key.startsWith('paint.')) {
      const paintKey = key.split('.')[1];
      onUpdate({ ...data, paint: { ...data.paint, [paintKey]: value } });
    } else if (key.startsWith('layout.')) {
      const layoutKey = key.split('.')[1];
      onUpdate({ ...data, layout: { ...data.layout, [layoutKey]: value } });
    } else {
      onUpdate({ ...data, [key]: value });
    }
  };

  return (
    <EditorPanel
      title="动态绘线"
      onClose={onClose}
      headerContent={
        <div className="flex bg-muted rounded-md p-1 gap-1">
          <Button
            variant={activeTab === 'symbol' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setActiveTab('symbol')}
          >
            符号
          </Button>
          <Button
            variant={activeTab === 'label' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setActiveTab('label')}
          >
            标注
          </Button>
        </div>
      }
    >
      {activeTab === 'symbol' ? (
        <>
          <SectionTitle>基础</SectionTitle>
          <FormItem label="完成时间">
            <div className="relative">
              <Input
                type="number"
                value={data.draw_finish}
                onChange={(e) => handleChange('draw_finish', parseFloat(e.target.value))}
                className="h-8 text-xs pr-8"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">ms</span>
            </div>
          </FormItem>
          <FormItem label="是否持久存在" className="flex items-center justify-between">
            <Switch
              checked={data.keepLive}
              onCheckedChange={(v) => handleChange('keepLive', v)}
            />
          </FormItem>

          <SectionTitle className="mt-4">渲染</SectionTitle>
          <FormItem label="线宽">
            <div className="relative">
              <Input
                type="number"
                value={data.paint.line_width}
                onChange={(e) => handleChange('paint.line_width', parseFloat(e.target.value))}
                className="h-8 text-xs pr-8"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">px</span>
            </div>
          </FormItem>
          <FormItem label="模糊">
            <div className="relative">
              <Input
                type="number"
                value={data.paint.line_blur}
                onChange={(e) => handleChange('paint.line_blur', parseFloat(e.target.value))}
                className="h-8 text-xs pr-8"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">px</span>
            </div>
          </FormItem>
          <FormItem label="颜色">
             <div className="flex gap-2">
                <Input
                  type="color"
                  value={data.paint.line_color}
                  onChange={(e) => handleChange('paint.line_color', e.target.value)}
                  className="w-8 h-8 p-0 border-0"
                />
                <Input
                  value={data.paint.line_color}
                  onChange={(e) => handleChange('paint.line_color', e.target.value)}
                  className="flex-1 h-8 text-xs font-mono"
                />
              </div>
          </FormItem>

          <SectionTitle className="mt-4">其他样式</SectionTitle>
          <FormItem label="端点样式">
            <Select
              value={data.layout.line_cap}
              onChange={(e) => handleChange('layout.line_cap', e.target.value)}
            >
              {CAP_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
          </FormItem>
          <FormItem label="连接样式">
            <Select
              value={data.layout.line_join}
              onChange={(e) => handleChange('layout.line_join', e.target.value)}
            >
               {JOIN_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
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
        </>
      ) : (
        <div className="text-xs text-muted-foreground p-4">
          暂无标注设置
        </div>
      )}
    </EditorPanel>
  );
}
