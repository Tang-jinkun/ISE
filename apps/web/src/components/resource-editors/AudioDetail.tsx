import React, { useState } from 'react';
import { EditorPanel, SectionTitle, FormItem, FormRow } from './EditorPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export interface AudioDetailProps {
  data: {
    id: string;
    volume: number;
    fadeInTime?: number;
    fadeOutTime?: number;
    currentTime?: number;
    muted?: boolean;
    loop?: boolean;
    playbackRate?: number;
    speed?: number;
    startTime?: number;
    endTime?: number;
  };
  onUpdate: (data: Partial<AudioDetailProps['data']>) => void;
  onClose?: () => void;
}

export function AudioDetail({ data, onUpdate, onClose }: AudioDetailProps) {
  const [activeTab, setActiveTab] = useState<'basic' | 'speed'>('basic');

  const handleChange = (key: keyof AudioDetailProps['data'], value: any) => {
    onUpdate({ [key]: value });
  };

  const speed = data.speed ?? data.playbackRate ?? 1;

  return (
    <EditorPanel
      title="音频"
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
            variant={activeTab === 'speed' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setActiveTab('speed')}
          >
            变速设置
          </Button>
        </div>
      }
    >
      {activeTab === 'basic' ? (
        <>
          <SectionTitle>基础</SectionTitle>
          <div className="space-y-4">
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

            {(data.fadeInTime !== undefined) && (
              <FormItem label="淡入时长 (ms)">
                <div className="flex gap-3 items-center">
                  <Slider
                    value={[data.fadeInTime]}
                    min={0}
                    max={10000}
                    step={100}
                    onValueChange={([v]) => handleChange('fadeInTime', v)}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={data.fadeInTime}
                    onChange={(e) => handleChange('fadeInTime', parseFloat(e.target.value))}
                    className="w-16 h-8 text-xs"
                  />
                </div>
              </FormItem>
            )}

            {(data.fadeOutTime !== undefined) && (
              <FormItem label="淡出时长 (ms)">
                <div className="flex gap-3 items-center">
                  <Slider
                    value={[data.fadeOutTime]}
                    min={0}
                    max={10000}
                    step={100}
                    onValueChange={([v]) => handleChange('fadeOutTime', v)}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={data.fadeOutTime}
                    onChange={(e) => handleChange('fadeOutTime', parseFloat(e.target.value))}
                    className="w-16 h-8 text-xs"
                  />
                </div>
              </FormItem>
            )}

            <SectionTitle className="mt-6 border-t pt-4">调节</SectionTitle>

            {(data.currentTime !== undefined) && (
              <FormItem label="当前时间 (ms)">
                <Input
                  type="number"
                  value={data.currentTime}
                  onChange={(e) => handleChange('currentTime', parseFloat(e.target.value))}
                  className="h-8 text-xs"
                />
              </FormItem>
            )}

            {(data.muted !== undefined) && (
              <FormRow>
                <div className="col-span-4 text-xs">静音</div>
                <div className="col-span-8 flex justify-end">
                  <Switch
                    checked={data.muted}
                    onCheckedChange={(c) => handleChange('muted', c)}
                  />
                </div>
              </FormRow>
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

            {(data.startTime !== undefined || data.endTime !== undefined) && (
              <>
                <SectionTitle className="mt-6 border-t pt-4">时长</SectionTitle>

                {(data.startTime !== undefined) && (
                  <FormItem label="起始时间">
                    <Input
                      type="number"
                      value={data.startTime}
                      onChange={(e) => handleChange('startTime', parseFloat(e.target.value))}
                      className="h-8 text-xs"
                    />
                  </FormItem>
                )}

                {(data.endTime !== undefined) && (
                  <FormItem label="终止时间">
                    <Input
                      type="number"
                      value={data.endTime}
                      onChange={(e) => handleChange('endTime', parseFloat(e.target.value))}
                      className="h-8 text-xs"
                    />
                  </FormItem>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <SectionTitle>变速</SectionTitle>
          <div className="space-y-4">
            <FormItem label="倍数">
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
