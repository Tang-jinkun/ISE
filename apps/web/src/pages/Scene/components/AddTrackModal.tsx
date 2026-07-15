import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  Activity,
  ArrowRightLeft,
  FileText,
  Grid,
  Image as ImageIcon,
  MapPin,
  Move,
  Music,
  RefreshCcw,
  Spline,
  Target,
  Video
} from 'lucide-react';

interface AddTrackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (type: string) => void;
}

const trackCategories = [
  {
    title: '视角控制类',
    items: [
      {
        id: 'ViewChange',
        label: '视角转移',
        icon: ArrowRightLeft,
        color: 'text-cyan-400',
        bg: 'bg-cyan-500/10 border-cyan-500/20'
      },
      {
        id: 'CameraRotate',
        label: '视角旋转',
        icon: RefreshCcw,
        color: 'text-cyan-400',
        bg: 'bg-cyan-500/10 border-cyan-500/20'
      },
      {
        id: 'CameraAlong',
        label: '视角跟随',
        icon: Move,
        color: 'text-cyan-400',
        bg: 'bg-cyan-500/10 border-cyan-500/20'
      }
    ]
  },
  {
    title: '媒体素材',
    items: [
      {
        id: 'Video',
        label: '视频',
        icon: Video,
        color: 'text-purple-400',
        bg: 'bg-purple-500/10 border-purple-500/20'
      },
      {
        id: 'Picture',
        label: '图片',
        icon: ImageIcon,
        color: 'text-blue-400',
        bg: 'bg-blue-500/10 border-blue-500/20'
      },
      {
        id: 'Audio',
        label: '音频',
        icon: Music,
        color: 'text-emerald-400',
        bg: 'bg-emerald-500/10 border-emerald-500/20'
      },
      {
        id: 'Text/Subtitle',
        label: '文本',
        icon: FileText,
        color: 'text-yellow-400',
        bg: 'bg-yellow-500/10 border-yellow-500/20'
      }
    ]
  },
  {
    title: '地理要素',
    items: [
      {
        id: 'GeoJson',
        label: '矢量数据',
        icon: Activity,
        color: 'text-fuchsia-400',
        bg: 'bg-fuchsia-500/10 border-fuchsia-500/20'
      },
      {
        id: 'ImageRaster',
        label: '地理影像',
        icon: Grid,
        color: 'text-orange-400',
        bg: 'bg-orange-500/10 border-orange-500/20'
      },
      {
        id: 'Marker',
        label: '地图图标',
        icon: MapPin,
        color: 'text-red-400',
        bg: 'bg-red-500/10 border-red-500/20'
      },
      {
        id: 'DynamicLine',
        label: '动态绘制线',
        icon: Spline,
        color: 'text-indigo-400',
        bg: 'bg-indigo-500/10 border-indigo-500/20'
      },
      {
        id: 'PlotSymbol',
        label: '军事标绘',
        icon: Target,
        color: 'text-indigo-400',
        bg: 'bg-indigo-500/10 border-indigo-500/20'
      }
    ]
  }
];

export function AddTrackModal({
  open,
  onOpenChange,
  onSelect
}: AddTrackModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-background/95 backdrop-blur-xl border-border text-foreground sm:max-w-4xl p-6 shadow-2xl">
        <DialogHeader className="pb-4 border-b border-border">
          <DialogTitle className="text-xl font-medium tracking-wide">
            添加轨道
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-6">
          {trackCategories.map((category) => (
            <div key={category.title} className="space-y-3">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
                {category.title}
              </h3>
              <div className="grid grid-cols-5 gap-3">
                {category.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      onSelect(item.id);
                      onOpenChange(false);
                    }}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 group text-left',
                      'bg-card border-border hover:bg-accent hover:border-accent-foreground/20 hover:shadow-lg hover:-translate-y-0.5'
                    )}
                  >
                    <div
                      className={cn(
                        'w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
                        item.bg
                      )}
                    >
                      <item.icon className={cn('w-5 h-5', item.color)} />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                        {item.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground group-hover:text-muted-foreground/80">
                        {item.id}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
