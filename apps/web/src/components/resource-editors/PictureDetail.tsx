import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useState } from 'react';
import { EditorPanel, FormItem, SectionTitle } from './EditorPanel';

export interface PictureDetailProps {
  data: {
    left?: number;
    top?: number;
    pixelWidth?: number;
    height?: number;
    opacity?: number;
    borderRadius?: number;
    zIndex?: number;
    animation_in?: boolean;
    animation_out?: boolean;
    // Added for Script page compatibility
    brightness?: number;
    contrast?: number;
    scale?: number;
  };
  onUpdate: (data: Partial<PictureDetailProps['data']>) => void;
  onClose?: () => void;
}

export function PictureDetail({ data, onUpdate, onClose }: PictureDetailProps) {
  const [activeTab, setActiveTab] = useState<'basic' | 'animation'>('basic');

  const handleChange = (key: keyof PictureDetailProps['data'], value: any) => {
    onUpdate({ [key]: value });
  };

  return (
    <EditorPanel
      title="图片"
      onClose={onClose}
      headerContent={
        <div className="flex bg-muted rounded-md p-1 gap-1">
          <Button
            variant={activeTab === 'basic' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setActiveTab('basic')}
          >
            图片
          </Button>
          <Button
            variant={activeTab === 'animation' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setActiveTab('animation')}
          >
            动画
          </Button>
        </div>
      }
    >
      {activeTab === 'basic' ? (
        <>
          {(data.left !== undefined ||
            data.top !== undefined ||
            data.pixelWidth !== undefined ||
            data.height !== undefined) && (
            <>
              <SectionTitle>位置大小</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <FormItem label="位置">
                  <Input
                    type="number"
                    value={data.left ?? 0}
                    onChange={(e) =>
                      handleChange('left', parseFloat(e.target.value))
                    }
                    className="h-8 text-xs mb-2"
                    placeholder="Left"
                  />
                  <Input
                    type="number"
                    value={data.top ?? 0}
                    onChange={(e) =>
                      handleChange('top', parseFloat(e.target.value))
                    }
                    className="h-8 text-xs"
                    placeholder="Top"
                  />
                </FormItem>
                <FormItem label="大小">
                  <Input
                    type="number"
                    value={data.pixelWidth ?? 0}
                    onChange={(e) =>
                      handleChange('pixelWidth', parseFloat(e.target.value))
                    }
                    className="h-8 text-xs mb-2"
                    placeholder="Width"
                  />
                  <Input
                    type="number"
                    value={data.height ?? 0}
                    onChange={(e) =>
                      handleChange('height', parseFloat(e.target.value))
                    }
                    className="h-8 text-xs"
                    placeholder="Height"
                  />
                </FormItem>
              </div>
            </>
          )}

          <SectionTitle className="mt-4">样式</SectionTitle>

          {(data.brightness !== undefined ||
            data.contrast !== undefined ||
            data.scale !== undefined) && (
            <>
              <FormItem label="缩放">
                <div className="flex gap-3 items-center">
                  <Slider
                    value={[data.scale ?? 1]}
                    min={0.1}
                    max={3}
                    step={0.1}
                    onValueChange={([v]) => handleChange('scale', v)}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={data.scale ?? 1}
                    onChange={(e) =>
                      handleChange('scale', parseFloat(e.target.value))
                    }
                    className="w-16 h-8 text-xs"
                  />
                </div>
              </FormItem>
              <FormItem label="亮度">
                <div className="flex gap-3 items-center">
                  <Slider
                    value={[data.brightness ?? 0]}
                    min={-1}
                    max={1}
                    step={0.1}
                    onValueChange={([v]) => handleChange('brightness', v)}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={data.brightness ?? 0}
                    onChange={(e) =>
                      handleChange('brightness', parseFloat(e.target.value))
                    }
                    className="w-16 h-8 text-xs"
                  />
                </div>
              </FormItem>
              <FormItem label="对比度">
                <div className="flex gap-3 items-center">
                  <Slider
                    value={[data.contrast ?? 0]}
                    min={-1}
                    max={1}
                    step={0.1}
                    onValueChange={([v]) => handleChange('contrast', v)}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={data.contrast ?? 0}
                    onChange={(e) =>
                      handleChange('contrast', parseFloat(e.target.value))
                    }
                    className="w-16 h-8 text-xs"
                  />
                </div>
              </FormItem>
            </>
          )}

          {data.opacity !== undefined && (
            <FormItem label="不透明度">
              <div className="flex gap-3 items-center">
                <Slider
                  value={[data.opacity ?? 1]}
                  min={0}
                  max={1}
                  step={0.01}
                  onValueChange={([v]) => handleChange('opacity', v)}
                  className="flex-1"
                />
                <Input
                  type="number"
                  value={data.opacity ?? 1}
                  onChange={(e) =>
                    handleChange('opacity', parseFloat(e.target.value))
                  }
                  className="w-16 h-8 text-xs"
                />
              </div>
            </FormItem>
          )}
          {data.borderRadius !== undefined && (
            <FormItem label="圆角">
              <div className="flex gap-3 items-center">
                <Slider
                  value={[data.borderRadius ?? 0]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={([v]) => handleChange('borderRadius', v)}
                  className="flex-1"
                />
                <Input
                  type="number"
                  value={data.borderRadius ?? 0}
                  onChange={(e) =>
                    handleChange('borderRadius', parseFloat(e.target.value))
                  }
                  className="w-16 h-8 text-xs"
                />
              </div>
            </FormItem>
          )}

          {data.zIndex !== undefined && (
            <>
              <SectionTitle className="mt-4">层级</SectionTitle>
              <FormItem label="素材层级">
                <div className="flex gap-3 items-center">
                  <Slider
                    value={[data.zIndex ?? 0]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={([v]) => handleChange('zIndex', v)}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={data.zIndex ?? 0}
                    onChange={(e) =>
                      handleChange('zIndex', parseFloat(e.target.value))
                    }
                    className="w-16 h-8 text-xs"
                  />
                </div>
              </FormItem>
            </>
          )}
        </>
      ) : (
        <>
          <SectionTitle>淡入淡出</SectionTitle>
          <FormItem
            label="图片淡入"
            className="flex items-center justify-between"
          >
            <Switch
              checked={data.animation_in ?? false}
              onCheckedChange={(v) => handleChange('animation_in', v)}
            />
          </FormItem>
          <FormItem
            label="图片淡出"
            className="flex items-center justify-between"
          >
            <Switch
              checked={data.animation_out ?? false}
              onCheckedChange={(v) => handleChange('animation_out', v)}
            />
          </FormItem>
        </>
      )}
    </EditorPanel>
  );
}
