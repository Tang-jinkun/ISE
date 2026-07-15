import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Plus } from 'lucide-react';
import { EditorPanel, FormItem, SectionTitle } from './EditorPanel';

export interface MarkerDetailProps {
  data: {
    pixelWidth: number;
    height: number;
    backgroundSize: number;
    keepLive: boolean;
    file_id: string;
    start: number;
    finish: number;
  };
  onUpdate: (data: Partial<MarkerDetailProps['data']>) => void;
  onSelectImage?: () => void;
  onClose?: () => void;
}

export function MarkerDetail({
  data,
  onUpdate,
  onSelectImage,
  onClose
}: MarkerDetailProps) {
  const handleChange = (key: keyof MarkerDetailProps['data'], value: any) => {
    onUpdate({ [key]: value });
  };

  const imageUrl = data.file_id
    ? `${import.meta.env.PUBLIC_WEB_URL}/SceneCreater/file-list/getFileAvatar/${data.file_id}`
    : '';

  return (
    <EditorPanel title="地图图标" onClose={onClose}>
      <SectionTitle>图标大小</SectionTitle>

      <div className="grid grid-cols-2 gap-4">
        <FormItem label="背景大小">
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              宽
            </span>
            <Input
              type="number"
              value={data.pixelWidth}
              onChange={(e) =>
                handleChange('pixelWidth', parseFloat(e.target.value))
              }
              className="h-8 text-xs pl-6 pr-8"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              px
            </span>
          </div>
        </FormItem>
        <FormItem label="&nbsp;">
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              高
            </span>
            <Input
              type="number"
              value={data.height}
              onChange={(e) =>
                handleChange('height', parseFloat(e.target.value))
              }
              className="h-8 text-xs pl-6 pr-8"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              px
            </span>
          </div>
        </FormItem>
      </div>

      <FormItem label="背景缩放">
        <div className="relative">
          <Input
            type="number"
            value={data.backgroundSize}
            onChange={(e) =>
              handleChange('backgroundSize', parseFloat(e.target.value))
            }
            className="h-8 text-xs pr-8"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            %
          </span>
        </div>
      </FormItem>

      <SectionTitle className="mt-4">基础</SectionTitle>
      <FormItem label="是否失活" className="flex items-center justify-between">
        <Switch
          checked={data.keepLive}
          onCheckedChange={(v) => handleChange('keepLive', v)}
        />
      </FormItem>

      <SectionTitle className="mt-4">附加属性</SectionTitle>
      <FormItem label="图片资源">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={onSelectImage}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <div className="relative flex-1">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              uuid
            </span>
            <Input
              value={data.file_id}
              disabled
              className="h-8 text-xs pl-10"
            />
          </div>
        </div>
      </FormItem>

      {imageUrl && (
        <FormItem label="背景图片">
          <div className="border rounded-md p-1 bg-muted/20 h-32 flex items-center justify-center overflow-hidden">
            <img
              src={imageUrl}
              alt="Marker"
              className="max-w-full max-h-full object-contain"
            />
          </div>
        </FormItem>
      )}

      <SectionTitle className="mt-4">时长</SectionTitle>
      <FormItem label="起始时间">
        <div className="relative">
          <Input
            type="number"
            value={data.start}
            onChange={(e) => handleChange('start', parseFloat(e.target.value))}
            className="h-8 text-xs pr-8"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            ms
          </span>
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
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            ms
          </span>
        </div>
      </FormItem>
    </EditorPanel>
  );
}
