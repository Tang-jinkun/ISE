import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useState } from 'react';
import { EditorPanel, FormItem, SectionTitle } from './EditorPanel';

interface PointStyle {
  color: string;
  pixelSize: number;
  outlineColor: string;
  outlineWidth: number;
}

interface LineStyle {
  color: string;
  width: number;
  lineDash: number[];
}

interface PolygonStyle {
  fill: boolean;
  fillColor: string;
  outline: boolean;
  outlineColor: string;
  outlineWidth: number;
}

export interface PlotSymbolDetailProps {
  data: {
    size: number;
    opacity: number;
    keepLive: boolean;
    hasTrack: boolean;
    pointStyle?: PointStyle;
    lineStyle?: LineStyle;
    polygonStyle?: PolygonStyle;
  };
  onUpdate: (data: Partial<PlotSymbolDetailProps['data']>) => void;
  onClose?: () => void;
}

export function PlotSymbolDetail({
  data,
  onUpdate,
  onClose
}: PlotSymbolDetailProps) {
  const [activeTab, setActiveTab] = useState('point');

  const handleChange = (key: string, value: any) => {
    const keys = key.split('.');
    if (keys.length > 1) {
      const [styleKey, propKey] = keys;
      const currentStyle = data[
        styleKey as 'pointStyle' | 'lineStyle' | 'polygonStyle'
      ] ?? {};
      onUpdate({
        [styleKey]: { ...currentStyle, [propKey]: value }
      } as any);
    } else {
      onUpdate({ [key]: value });
    }
  };

  const ColorInput = ({
    value,
    onChange
  }: {
    value: string;
    onChange: (v: string) => void;
  }) => (
    <div className="relative flex items-center">
      <Input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-8 p-1 border-none bg-transparent cursor-pointer"
      />
      <span className="text-xs text-muted-foreground ml-2 uppercase">
        {value}
      </span>
    </div>
  );

  return (
    <EditorPanel title="态势符号" onClose={onClose}>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 h-9 bg-muted/80">
          <TabsTrigger value="point" className="text-xs">
            点样式
          </TabsTrigger>
          <TabsTrigger value="line" className="text-xs">
            线样式
          </TabsTrigger>
          <TabsTrigger value="polygon" className="text-xs">
            面样式
          </TabsTrigger>
        </TabsList>

        <TabsContent value="point" className="mt-4 space-y-4">
          <SectionTitle>点符号</SectionTitle>
          {data.pointStyle && (
            <>
              <FormItem label="颜色">
                <ColorInput
                  value={data.pointStyle.color}
                  onChange={(v) => handleChange('pointStyle.color', v)}
                />
              </FormItem>
              <FormItem label="大小 (px)">
                <Slider
                  value={[data.pointStyle.pixelSize]}
                  min={1}
                  max={50}
                  step={1}
                  onValueChange={([v]) =>
                    handleChange('pointStyle.pixelSize', v)
                  }
                />
              </FormItem>
              <FormItem label="轮廓颜色">
                <ColorInput
                  value={data.pointStyle.outlineColor}
                  onChange={(v) => handleChange('pointStyle.outlineColor', v)}
                />
              </FormItem>
              <FormItem label="轮廓宽度 (px)">
                <Slider
                  value={[data.pointStyle.outlineWidth]}
                  min={0}
                  max={10}
                  step={1}
                  onValueChange={([v]) =>
                    handleChange('pointStyle.outlineWidth', v)
                  }
                />
              </FormItem>
            </>
          )}
        </TabsContent>

        <TabsContent value="line" className="mt-4 space-y-4">
          <SectionTitle>线符号</SectionTitle>
          {data.lineStyle && (
            <>
              <FormItem label="颜色">
                <ColorInput
                  value={data.lineStyle.color}
                  onChange={(v) => handleChange('lineStyle.color', v)}
                />
              </FormItem>
              <FormItem label="宽度 (px)">
                <Slider
                  value={[data.lineStyle.width]}
                  min={1}
                  max={20}
                  step={1}
                  onValueChange={([v]) => handleChange('lineStyle.width', v)}
                />
              </FormItem>
              <FormItem label="虚线样式">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => handleChange('lineStyle.lineDash', [5, 5])}
                  >
                    [5, 5]
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => handleChange('lineStyle.lineDash', [10, 10])}
                  >
                    [10, 10]
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => handleChange('lineStyle.lineDash', [])}
                  >
                    实线
                  </Button>
                </div>
              </FormItem>
            </>
          )}
        </TabsContent>

        <TabsContent value="polygon" className="mt-4 space-y-4">
          <SectionTitle>面符号</SectionTitle>
          {data.polygonStyle && (
            <>
              <FormItem
                label="填充"
                className="flex items-center justify-between"
              >
                <Switch
                  checked={data.polygonStyle.fill}
                  onCheckedChange={(v) => handleChange('polygonStyle.fill', v)}
                />
              </FormItem>
              {data.polygonStyle.fill && (
                <FormItem label="填充颜色">
                  <ColorInput
                    value={data.polygonStyle.fillColor}
                    onChange={(v) => handleChange('polygonStyle.fillColor', v)}
                  />
                </FormItem>
              )}
              <FormItem
                label="轮廓"
                className="flex items-center justify-between"
              >
                <Switch
                  checked={data.polygonStyle.outline}
                  onCheckedChange={(v) =>
                    handleChange('polygonStyle.outline', v)
                  }
                />
              </FormItem>
              {data.polygonStyle.outline && (
                <>
                  <FormItem label="轮廓颜色">
                    <ColorInput
                      value={data.polygonStyle.outlineColor}
                      onChange={(v) =>
                        handleChange('polygonStyle.outlineColor', v)
                      }
                    />
                  </FormItem>
                  <FormItem label="轮廓宽度 (px)">
                    <Slider
                      value={[data.polygonStyle.outlineWidth]}
                      min={0}
                      max={10}
                      step={1}
                      onValueChange={([v]) =>
                        handleChange('polygonStyle.outlineWidth', v)
                      }
                    />
                  </FormItem>
                </>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      <div className="h-px bg-border/50 my-4" />

      <SectionTitle>通用属性</SectionTitle>
      <FormItem label="不透明度">
        <Slider
          value={[data.opacity ?? 1]}
          min={0}
          max={1}
          step={0.01}
          onValueChange={([v]) => handleChange('opacity', v)}
        />
      </FormItem>
      <FormItem
        label="是否持久存在"
        className="flex items-center justify-between mt-2"
      >
        <Switch
          checked={data.keepLive}
          onCheckedChange={(v) => handleChange('keepLive', v)}
        />
      </FormItem>
      <FormItem
        label="是否展示轨迹"
        className="flex items-center justify-between mt-2"
      >
        <Switch
          checked={data.hasTrack}
          onCheckedChange={(v) => handleChange('hasTrack', v)}
        />
      </FormItem>
    </EditorPanel>
  );
}
