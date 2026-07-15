import {
  AudioDetail,
  CameraAlongDetail,
  CameraRotateDetail,
  DynamicLayerDetail,
  EditorProvider,
  FilmDetail,
  GeojsonDetail,
  ImageRasterDetail,
  MapEaseDetail,
  MarkerDetail,
  PictureDetail,
  PlotSymbolDetail,
  SceneDetail,
  TextDetail,
  VideoDetail
} from '@/components/resource-editors';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown';
import { Input } from '@/components/ui/input';
import { useSceneStore } from '@/stores/sceneStore';
import {
  Activity,
  Camera,
  Film,
  GitMerge,
  Image as ImageIcon,
  Layers,
  Map as MapIcon,
  MapPin,
  MousePointer2,
  Music,
  RotateCw,
  Settings,
  Type,
  Video,
  Zap
} from 'lucide-react';
import { useState } from 'react';

// Helper component for form rows
const FormRow = ({
  label,
  value,
  readOnly = false
}: {
  label: string;
  value: string | number;
  readOnly?: boolean;
}) => (
  <div className="space-y-1">
    <div className="text-[11px] text-muted-foreground">{label}</div>
    <Input
      defaultValue={value}
      readOnly={readOnly}
      className="h-8 rounded-lg border-border bg-background text-xs"
    />
  </div>
);

const CommonProperties = ({ clip }: { clip: any }) => (
  <div className="space-y-2">
    <div className="text-[11px] text-muted-foreground font-medium">
      基础属性
    </div>
    <div className="grid grid-cols-2 gap-2">
      <FormRow label="开始时间 (s)" value={clip.start} />
      <FormRow label="终止时间 (s)" value={clip.width} />
    </div>
  </div>
);

const MOCK_CLIPS: Record<string, any> = {
  image: {
    id: 'mock-picture-1',
    label: '诺曼底登陆.png',
    trackId: 'track-2',
    trackType: 'image',
    start: 10,
    width: 5,
    color: 'bg-blue-500/50 border-blue-500',
    left: 10,
    top: 10,
    pixelWidth: 300,
    height: 200,
    opacity: 1,
    brightness: 100,
    contrast: 100,
    scale: 1,
    borderRadius: 4,
    zIndex: 1,
    animation_in: true,
    animation_out: false
  },
  video: {
    id: 'mock-video-1',
    label: '战场全景.mp4',
    trackId: 'track-3',
    trackType: 'video',
    start: 0,
    width: 15,
    left: 0,
    top: 0,
    pixelWidth: 1920,
    height: 1080,
    volume: 0.8,
    loop: true,
    opacity: 1,
    speed: 1
  },
  audio: {
    id: 'mock-audio-1',
    label: '背景音乐.mp3',
    trackId: 'track-1',
    trackType: 'audio',
    start: 0,
    width: 60,
    volume: 0.5,
    fadeInTime: 1000,
    fadeOutTime: 1000,
    loop: true
  },
  text: {
    id: 'mock-text-1',
    label: '标题文本',
    trackId: 'track-4',
    trackType: 'text',
    start: 2,
    width: 8,
    purpose: 'text',
    content: '1944年6月6日 诺曼底',
    fontFamily: 'SimHei',
    fontSize: 48,
    color: '#ffffff',
    backgroundColor: 'transparent',
    bold: true,
    italic: false,
    underline: false,
    strikethrough: false,
    lineHeight: 1.2,
    letterSpacing: 2,
    opacity: 1,
    shadowColor: '#000000',
    shadowBlur: 4,
    strokeColor: '#000000',
    strokeWidth: 0
  },
  vector: {
    id: 'mock-vector-1',
    label: '进攻路线.geojson',
    trackId: 'track-5',
    trackType: 'vector',
    start: 5,
    width: 10,
    keepLive: true,
    type: 'LineString',
    animation: 'none',
    // Text properties
    textSize: 14,
    textColor: '#ffffff',
    textHaloColor: '#000000',
    textHaloWidth: 1,
    // Line properties
    // lineWidth: 3,
    // lineColor: '#ff0000',
    // lineDasharray: [2, 2],
    // Fill properties
    fillColor: '#0000ff',
    fillOpacity: 0.5,
    fillOutlineColor: '#0000ff',
    // Circle properties (for Point features)
    paint: {
      'circle-radius': 8,
      'circle-color': '#ffff00',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff'
    }
  },
  raster: {
    id: 'mock-raster-1',
    label: '卫星底图.tif',
    trackId: 'track-6',
    trackType: 'raster',
    start: 0,
    width: 100,
    keepLive: true,
    paint: {
      imageRasterOpacity: 1,
      imageRasterContrast: 0,
      imageRasterSaturation: 0,
      imagerasterMinBright: 0,
      imagerasterMaxBright: 1,
      imagerasterResamling: 'linear',
      imagerasterFadeDuration: 300
    }
  },
  icon: {
    id: 'mock-icon-1',
    label: '坦克位置',
    trackId: 'track-7',
    trackType: 'icon',
    start: 10,
    width: 20,
    pixelWidth: 32,
    height: 32,
    backgroundSize: 100,
    keepLive: true,
    file_id: 'mock-file-id'
  },
  dynamic_line: {
    id: 'mock-dynamic-line-1',
    label: '动态推进线',
    trackId: 'track-8',
    trackType: 'dynamic_line',
    start: 12,
    width: 5,
    draw_finish: 3000,
    keepLive: true,
    paint: {
      line_width: 2,
      line_blur: 0,
      line_color: '#ffff00'
    },
    layout: {
      line_cap: 'round',
      line_join: 'round'
    }
  },
  camera_move: {
    id: 'mock-camera-move-1',
    label: '视角跟随',
    trackId: 'track-9',
    trackType: 'camera_move',
    start: 0,
    width: 10,
    cameraAltitude: 45,
    finish: 10000
  },
  camera_rotate: {
    id: 'mock-camera-rotate-1',
    label: '视角旋转',
    trackId: 'track-10',
    trackType: 'camera_rotate',
    start: 5000,
    width: 5,
    pitch: 30,
    finish: 10000,
    lon: 120,
    lat: 30,
    zoom: 10
  },
  camera_transition: {
    id: 'mock-camera-transition-1',
    label: '视角转移',
    trackId: 'track-11',
    trackType: 'camera_transition',
    start: 15000,
    width: 3,
    lon: 121,
    lat: 31,
    zoom: 12,
    pitch: 45,
    bearing: 90,
    finish: 18000
  },
  film: {
    id: 'mock-film-1',
    label: '历史影片',
    trackId: 'track-12',
    trackType: 'film',
    start: 20,
    width: 30,
    opacity: 1,
    volume: 1,
    loop: false,
    speed: 1
  },
  plot_symbol: {
    id: 'mock-plotsymbol-1',
    label: '攻击箭头',
    trackId: 'track-13',
    trackType: 'plot_symbol',
    start: 3,
    width: 12,
    size: 1,
    opacity: 1,
    keepLive: true,
    hasTrack: false,
    pointStyle: {
      color: '#ff0000',
      pixelSize: 10,
      outlineColor: '#ffffff',
      outlineWidth: 2
    },
    lineStyle: {
      color: '#0000ff',
      width: 2,
      lineDash: []
    },
    polygonStyle: {
      fill: true,
      fillColor: 'rgba(0, 255, 0, 0.5)',
      outline: true,
      outlineColor: '#00ff00',
      outlineWidth: 1
    }
  },
  scene: {
    id: 'mock-scene-1',
    label: '场景信息',
    trackId: 'track-0',
    trackType: 'scene',
    start: 0,
    width: 0,
    description: '诺曼底登陆战役模拟',
    creator: '管理员',
    scene_type: '历史模拟',
    create_time: Date.now(),
    update_time: Date.now(),
    stage_title: [
      { key: 's1', name: '第一阶段', title: '登岸准备' },
      { key: 's2', name: '第二阶段', title: '抢滩登陆' }
    ]
  }
};

export function PropertyPanel() {
  const selectedClipFromStore = useSceneStore((state) => state.selectedClip);
  const updateSelectedClip = useSceneStore((state) => state.updateSelectedClip);
  const [mockType, setMockType] = useState<string | null>(null);

  // Use mock data if requested or if nothing is selected in store
  const selectedClip = mockType
    ? MOCK_CLIPS[mockType]
    : selectedClipFromStore || MOCK_CLIPS.image;

  const handleUpdate = (updates: any) => {
    if (mockType) {
      // If we are in mock mode, we don't update the store, just for preview
      console.log('Mock Update:', updates);
    } else {
      updateSelectedClip(updates);
    }
  };

  const renderSpecificForm = () => {
    const commonProps = {
      data: selectedClip as any,
      onUpdate: handleUpdate
    };

    switch (selectedClip.trackType) {
      case 'audio':
        return <AudioDetail {...commonProps} />;
      case 'video':
        return <VideoDetail {...commonProps} />;
      case 'image':
        return <PictureDetail {...commonProps} />;
      case 'text':
        return <TextDetail {...commonProps} />;
      case 'scene':
        return <SceneDetail {...commonProps} />;
      case 'vector':
        return <GeojsonDetail {...commonProps} />;
      case 'raster':
        return <ImageRasterDetail {...commonProps} />;
      case 'icon':
        return <MarkerDetail {...commonProps} />;
      case 'dynamic_line':
        return <DynamicLayerDetail {...commonProps} />;
      case 'camera_move':
        return <CameraAlongDetail {...commonProps} />;
      case 'camera_rotate':
        return <CameraRotateDetail {...commonProps} />;
      case 'camera_transition':
        return <MapEaseDetail {...commonProps} />;
      case 'film':
        return <FilmDetail {...commonProps} />;
      case 'plot_symbol':
        return <PlotSymbolDetail {...commonProps} />;
      default:
        return (
          <div className="text-xs text-muted-foreground">暂无特定属性</div>
        );
    }
  };

  const menuItems = [
    {
      type: 'scene',
      label: '场景信息',
      icon: <Layers className="w-3.5 h-3.5" />
    },
    {
      type: 'image',
      label: '图片属性',
      icon: <ImageIcon className="w-3.5 h-3.5" />
    },
    {
      type: 'video',
      label: '视频属性',
      icon: <Video className="w-3.5 h-3.5" />
    },
    {
      type: 'audio',
      label: '音频属性',
      icon: <Music className="w-3.5 h-3.5" />
    },
    { type: 'text', label: '文本属性', icon: <Type className="w-3.5 h-3.5" /> },
    {
      type: 'vector',
      label: '矢量(GeoJSON)',
      icon: <MapIcon className="w-3.5 h-3.5" />
    },
    {
      type: 'raster',
      label: '栅格属性',
      icon: <Activity className="w-3.5 h-3.5" />
    },
    {
      type: 'icon',
      label: '地图图标',
      icon: <MapPin className="w-3.5 h-3.5" />
    },
    {
      type: 'dynamic_line',
      label: '动态绘线',
      icon: <Zap className="w-3.5 h-3.5" />
    },
    {
      type: 'camera_move',
      label: '视角跟随',
      icon: <MousePointer2 className="w-3.5 h-3.5" />
    },
    {
      type: 'camera_rotate',
      label: '视角旋转',
      icon: <RotateCw className="w-3.5 h-3.5" />
    },
    {
      type: 'camera_transition',
      label: '视角转移',
      icon: <Camera className="w-3.5 h-3.5" />
    },
    { type: 'film', label: '影片属性', icon: <Film className="w-3.5 h-3.5" /> },
    {
      type: 'plot_symbol',
      label: '态势符号',
      icon: <GitMerge className="w-3.5 h-3.5" />
    }
  ];

  return (
    <aside className="w-80 border-l border-border bg-card flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Layers className="w-3.5 h-3.5 text-cyan-400" />
          <span className="truncate max-w-[180px]">
            属性编辑
            {/* - {selectedClip.label} */}
          </span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
            >
              <Settings className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-48 bg-popover border-border"
          >
            <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase">
              切换预览类型 (Mock)
            </div>
            {menuItems.map((item) => (
              <DropdownMenuItem
                key={item.type}
                className="flex items-center gap-2 text-xs cursor-pointer hover:bg-accent"
                onClick={() => {
                  setMockType(item.type);
                  // Clear store selection if we are in mock mode to avoid confusion
                  // But usually we just let mockType override it
                }}
              >
                <span className="text-muted-foreground">{item.icon}</span>
                {item.label}
              </DropdownMenuItem>
            ))}
            {mockType && (
              <>
                <div className="h-px bg-border my-1" />
                <DropdownMenuItem
                  className="flex items-center gap-2 text-xs cursor-pointer text-red-400 hover:text-red-500 hover:bg-red-500/10"
                  onClick={() => setMockType(null)}
                >
                  清除预览模式
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6 custom-scrollbar">
        {/* Force re-render when clip ID changes to update default values */}
        <div key={selectedClip.id}>
          <CommonProperties clip={selectedClip} />
          <div className="h-px bg-border/50 my-4" />
          <EditorProvider value={{ embedded: true }}>
            {renderSpecificForm()}
          </EditorProvider>
        </div>
      </div>
    </aside>
  );
}
