import React, { useState } from 'react';
import { EditorPanel, SectionTitle, FormItem, FormRow } from './EditorPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

export interface FilmDetailProps {
  data: {
    id: string;
    // Common properties
    volume?: number;
    muted?: boolean;
    loop?: boolean;
    playbackRate?: number;
    speed?: number;
    startTime?: number;
    endTime?: number;
    // Film specific?
    opacity?: number;
  };
  onUpdate: (data: Partial<FilmDetailProps['data']>) => void;
  onClose?: () => void;
}

export function FilmDetail({ data, onUpdate, onClose }: FilmDetailProps) {
  const [activeTab, setActiveTab] = useState<'basic' | 'advanced'>('basic');

  const handleChange = (key: keyof FilmDetailProps['data'], value: any) => {
    onUpdate({ [key]: value });
  };

  const speed = data.speed ?? data.playbackRate ?? 1;

  return (
    <EditorPanel
      title="影片"
      onClose={onClose}
      headerContent={
        <div className="flex bg-muted rounded-md p-1 gap-1">
          <Button
            variant={activeTab === 'basic' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setActiveTab('basic')}
          >
            基础设置
          </Button>
          <Button
            variant={activeTab === 'advanced' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setActiveTab('advanced')}
          >
            高级设置
          </Button>
        </div>
      }
    >
      {activeTab === 'basic' ? (
        <>
          <SectionTitle>基础</SectionTitle>
          <div className="space-y-4">
             {(data.opacity !== undefined) && (
              <FormItem label="不透明度">
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
            )}

            {(data.volume !== undefined) && (
              <FormItem label="音量">
                <div className="flex gap-3 items-center">
                  <Slider
                    value={[data.volume ?? 1]}
                    min={0}
                    max={1}
                    step={0.01}
                    onValueChange={([v]) => handleChange('volume', v)}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={data.volume ?? 1}
                    onChange={(e) => handleChange('volume', parseFloat(e.target.value))}
                    className="w-16 h-8 text-xs"
                  />
                </div>
              </FormItem>
            )}

             {(data.loop !== undefined) && (
              <FormRow>
                <div className="col-span-4 text-xs">循环播放</div>
                <div className="col-span-8 flex justify-end">
                  <Switch
                    checked={data.loop}
                    onCheckedChange={(c) => handleChange('loop', c)}
                  />
                </div>
              </FormRow>
            )}
          </div>
        </>
      ) : (
        <>
          <SectionTitle>高级</SectionTitle>
          <div className="space-y-4">
             <FormItem label="播放速度">
              <div className="flex gap-3 items-center">
                <Slider
                  value={[speed]}
                  min={0.1}
                  max={4}
                  step={0.1}
                  onValueChange={([v]) => {
                    if (data.speed !== undefined) handleChange('speed', v);
                    else handleChange('playbackRate', v);
                  }}
                  className="flex-1"
                />
                <Input
                  type="number"
                  value={speed}
                  onChange={(e) => {
                     const v = parseFloat(e.target.value);
                     if (data.speed !== undefined) handleChange('speed', v);
                     else handleChange('playbackRate', v);
                  }}
                  className="w-16 h-8 text-xs"
                />
              </div>
            </FormItem>
          </div>
        </>
      )}
    </EditorPanel>
  );
}
