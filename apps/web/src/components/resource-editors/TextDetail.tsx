import React, { useState } from 'react';
import { EditorPanel, SectionTitle, FormItem } from './EditorPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Bold, Italic, Underline, Strikethrough } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TextDetailProps {
  data: {
    purpose: 'text' | 'subtitle';
    content: string;
    fontFamily: string;
    fontSize: number;
    color: string;
    backgroundColor: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strikethrough: boolean;
    lineHeight: number;
    letterSpacing: number;
    opacity: number;
    shadowColor: string;
    shadowBlur: number;
    strokeColor: string;
    strokeWidth: number;
  };
  onUpdate: (data: Partial<TextDetailProps['data']>) => void;
  onClose?: () => void;
}

const FONT_OPTIONS = [
  { label: '默认字体', value: 'Arial' },
  { label: '宋体', value: 'SimSun' },
  { label: '黑体', value: 'SimHei' },
  { label: '楷体', value: 'KaiTi' },
  { label: '微软雅黑', value: 'Microsoft YaHei' },
];

export function TextDetail({ data, onUpdate, onClose }: TextDetailProps) {
  const [activeTab, setActiveTab] = useState<'basic' | 'art'>('basic');

  const handleChange = (key: keyof TextDetailProps['data'], value: any) => {
    onUpdate({ [key]: value });
  };

  return (
    <EditorPanel
      title="文本"
      onClose={onClose}
      headerContent={
        <div className="flex bg-muted rounded-md p-1 gap-1">
          <Button
            variant={activeTab === 'basic' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setActiveTab('basic')}
          >
            基础
          </Button>
          <Button
            variant={activeTab === 'art' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setActiveTab('art')}
          >
            艺术
          </Button>
        </div>
      }
    >
      {activeTab === 'basic' ? (
        <>
          <SectionTitle>文字用途</SectionTitle>
          <RadioGroup
            className="flex gap-4 mb-4"
            value={data.purpose}
            onValueChange={(v) => handleChange('purpose', v as any)}
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="text" id="r-text" />
              <label htmlFor="r-text" className="text-xs">文字</label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="subtitle" id="r-subtitle" />
              <label htmlFor="r-subtitle" className="text-xs">字幕</label>
            </div>
          </RadioGroup>

          <SectionTitle>内容样式</SectionTitle>
          <FormItem label="内容">
            <Textarea
              value={data.content}
              onChange={(e) => handleChange('content', e.target.value)}
              maxLength={data.purpose === 'text' ? 1000 : 70}
              className="resize-none"
            />
          </FormItem>

          {data.purpose === 'text' && (
            <>
              <FormItem label="字体">
                <Select
                  value={data.fontFamily}
                  onChange={(e) => handleChange('fontFamily', e.target.value)}
                >
                  {FONT_OPTIONS.map((font) => (
                    <option key={font.value} value={font.value}>
                      {font.label}
                    </option>
                  ))}
                </Select>
              </FormItem>

              <FormItem label="样式">
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className={cn("h-8 w-8", data.bold && "bg-secondary text-primary")}
                    onClick={() => handleChange('bold', !data.bold)}
                  >
                    <Bold className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className={cn("h-8 w-8", data.italic && "bg-secondary text-primary")}
                    onClick={() => handleChange('italic', !data.italic)}
                  >
                    <Italic className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className={cn("h-8 w-8", data.underline && "bg-secondary text-primary")}
                    onClick={() => handleChange('underline', !data.underline)}
                  >
                    <Underline className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className={cn("h-8 w-8", data.strikethrough && "bg-secondary text-primary")}
                    onClick={() => handleChange('strikethrough', !data.strikethrough)}
                  >
                    <Strikethrough className="h-4 w-4" />
                  </Button>
                </div>
              </FormItem>

              <div className="grid grid-cols-2 gap-4">
                <FormItem label="字号">
                  <Input
                    type="number"
                    value={data.fontSize}
                    onChange={(e) => handleChange('fontSize', parseFloat(e.target.value))}
                    className="h-8 text-xs"
                  />
                </FormItem>
                <FormItem label="行高">
                  <Input
                    type="number"
                    value={data.lineHeight}
                    onChange={(e) => handleChange('lineHeight', parseFloat(e.target.value))}
                    className="h-8 text-xs"
                  />
                </FormItem>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-4">
                <FormItem label="字体颜色">
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={data.color}
                      onChange={(e) => handleChange('color', e.target.value)}
                      className="w-8 h-8 p-0 border-0"
                    />
                    <Input
                      value={data.color}
                      onChange={(e) => handleChange('color', e.target.value)}
                      className="flex-1 h-8 text-xs font-mono"
                    />
                  </div>
                </FormItem>
                <FormItem label="背景颜色">
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={data.backgroundColor}
                      onChange={(e) => handleChange('backgroundColor', e.target.value)}
                      className="w-8 h-8 p-0 border-0"
                    />
                    <Input
                      value={data.backgroundColor}
                      onChange={(e) => handleChange('backgroundColor', e.target.value)}
                      className="flex-1 h-8 text-xs font-mono"
                    />
                  </div>
                </FormItem>
              </div>

              <FormItem label="不透明度" className="mt-4">
                <div className="flex gap-3 items-center">
                  <Slider
                    value={[data.opacity]}
                    min={0}
                    max={1}
                    step={0.01}
                    onValueChange={([v]) => handleChange('opacity', v)}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={data.opacity}
                    onChange={(e) => handleChange('opacity', parseFloat(e.target.value))}
                    className="w-16 h-8 text-xs"
                  />
                </div>
              </FormItem>
            </>
          )}
        </>
      ) : (
        <>
          <SectionTitle>艺术效果</SectionTitle>
          <div className="space-y-4">
             <FormItem label="阴影颜色">
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={data.shadowColor}
                  onChange={(e) => handleChange('shadowColor', e.target.value)}
                  className="w-8 h-8 p-0 border-0"
                />
                <Input
                  value={data.shadowColor}
                  onChange={(e) => handleChange('shadowColor', e.target.value)}
                  className="flex-1 h-8 text-xs font-mono"
                />
              </div>
            </FormItem>
            <FormItem label="阴影模糊">
              <Slider
                value={[data.shadowBlur]}
                min={0}
                max={50}
                onValueChange={([v]) => handleChange('shadowBlur', v)}
              />
            </FormItem>

            <FormItem label="描边颜色">
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={data.strokeColor}
                  onChange={(e) => handleChange('strokeColor', e.target.value)}
                  className="w-8 h-8 p-0 border-0"
                />
                <Input
                  value={data.strokeColor}
                  onChange={(e) => handleChange('strokeColor', e.target.value)}
                  className="flex-1 h-8 text-xs font-mono"
                />
              </div>
            </FormItem>
             <FormItem label="描边宽度">
              <Slider
                value={[data.strokeWidth]}
                min={0}
                max={20}
                onValueChange={([v]) => handleChange('strokeWidth', v)}
              />
            </FormItem>
          </div>
        </>
      )}
    </EditorPanel>
  );
}
