import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { message } from '@/components/ui/message';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useUserStore } from '@/stores/userStore';
import {
  Activity,
  Calendar,
  FileText,
  Flag,
  History,
  Image as ImageIcon,
  Layers,
  Map as MapIcon,
  Music,
  Plus,
  Save,
  Shield,
  Tag,
  Video,
  X
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { PreAudio } from './preview/PreAudio';
import { PreImage } from './preview/PreImage';
import { PreMap } from './preview/PreMap';
import { PreVideo } from './preview/PreVideo';

export interface MaterialGovernanceModel {
  id: string;
  name: string;
  oldName: string;
  src: string;
  folderId: string;
  type: string;
  size: number;
  createdAt: string | Date;
  updatedAt: string | Date;
  userId: string;
  assetType:
    | 'picture'
    | 'geojson'
    | 'video'
    | 'audio'
    | 'imageraster'
    | 'plotsymbol';
  era?: string;
  faction?: string;
  tactics?: string[];
  functions?: string[];
  description?: string;
  embedding?: number[];
  visualLevel?: 1 | 2 | 3 | 4 | 5;
  coordinates?: [number, number];
  data?: any;
  bbox?: [number, number, number, number];
}

interface FilePreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: MaterialGovernanceModel | null;
  onSave?: (
    id: string,
    data: Partial<MaterialGovernanceModel>
  ) => Promise<void>;
}

export function FilePreviewModal({
  open,
  onOpenChange,
  file,
  onSave
}: FilePreviewModalProps) {
  const user = useUserStore((s) => s.user);
  const [governanceData, setGovernanceData] = useState<
    Partial<MaterialGovernanceModel>
  >({});
  const [newTactic, setNewTactic] = useState('');
  const [newFunction, setNewFunction] = useState('');

  useEffect(() => {
    if (file) {
      setGovernanceData({
        name: file.name,
        era: file.era || '',
        faction: file.faction || '',
        tactics: file.tactics || [],
        functions: file.functions || [],
        description: file.description || '',
        visualLevel: file.visualLevel || 1
      });
    }
  }, [file]);

  const handleAddTactic = () => {
    if (
      newTactic.trim() &&
      !governanceData.tactics?.includes(newTactic.trim())
    ) {
      setGovernanceData({
        ...governanceData,
        tactics: [...(governanceData.tactics || []), newTactic.trim()]
      });
      setNewTactic('');
    }
  };

  const handleAddFunction = () => {
    if (
      newFunction.trim() &&
      !governanceData.functions?.includes(newFunction.trim())
    ) {
      setGovernanceData({
        ...governanceData,
        functions: [...(governanceData.functions || []), newFunction.trim()]
      });
      setNewFunction('');
    }
  };

  const resolveUrl = (url: string) => {
    if (!url) return '';
    if (
      url.startsWith('http') ||
      url.startsWith('blob:') ||
      url.startsWith('/resource')
    )
      return url;
    const baseUrl = 'http://localhost:9000';
    const userEmail = user?.email || 'guest';
    const objectKey = `${userEmail}/${file?.assetType || 'file'}/${file?.name || ''}`;
    return `${baseUrl}/scene/${encodeURIComponent(objectKey)}`;
  };

  if (!file) return null;

  const resolvedUrl = resolveUrl(file.src);

  const renderContent = () => {
    const type = file.assetType;
    switch (type) {
      case 'picture':
        return <PreImage url={resolvedUrl} />;
      case 'imageraster':
        return (
          <PreMap
            rasterUrl={resolvedUrl}
            coordinates={file.coordinates || [-74.5, 40]}
            bbox={file.bbox}
          />
        );
      case 'audio':
        return <PreAudio url={resolvedUrl} />;
      case 'video':
        return <PreVideo url={resolvedUrl} />;
      case 'geojson':
        return (
          <PreMap
            geojsonUrl={resolvedUrl}
            geojsonData={file.data}
            coordinates={file.coordinates || [-74.5, 40]}
          />
        );
      case 'plotsymbol':
        return (
          <PreMap
            symbolUrl={resolvedUrl}
            geojsonData={file.data}
            coordinates={file.coordinates || [-74.5, 40]}
          />
        );
      default:
        return (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <FileText className="w-12 h-12 mb-2 opacity-50" />
            <p>不支持预览该文件类型</p>
          </div>
        );
    }
  };

  const getIcon = () => {
    switch (file.assetType) {
      case 'picture':
        return <ImageIcon className="w-5 h-5" />;
      case 'video':
        return <Video className="w-5 h-5" />;
      case 'geojson':
        return <MapIcon className="w-5 h-5" />;
      case 'audio':
        return <Music className="w-5 h-5" />;
      case 'imageraster':
        return <Layers className="w-5 h-5" />;
      case 'plotsymbol':
        return <Activity className="w-5 h-5" />;
      default:
        return <FileText className="w-5 h-5" />;
    }
  };

  const handleSave = async () => {
    if (!file || !onSave) {
      message.info('保存功能不可用');
      return;
    }
    try {
      await onSave(file.id, governanceData);
      message.success('治理信息保存成功');
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      message.error('保存失败');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1400px] h-[85vh] p-0 overflow-hidden bg-background/95 backdrop-blur-xl border-border/50 flex flex-row">
        {/* Left Side: Preview Area */}
        <div className="flex-[6] flex flex-col min-w-0 border-r border-border bg-black/5">
          <DialogHeader className="px-6 py-4 border-b border-border flex flex-row items-center gap-3 bg-background/50">
            <div className="p-2.5 bg-cyan-500/10 rounded-lg text-cyan-600 dark:text-cyan-400">
              {getIcon()}
            </div>
            <div className="flex flex-col">
              <DialogTitle className="text-lg font-bold text-foreground">
                {file.name}
              </DialogTitle>
              <span className="text-xs text-muted-foreground">
                素材治理与语义增强预览
              </span>
            </div>
          </DialogHeader>

          <div className="flex-1 p-8 flex items-center justify-center overflow-auto relative">
            <div className="w-full h-full flex items-center justify-center rounded-xl border border-border/50 bg-background/40 shadow-inner overflow-hidden">
              {renderContent()}
            </div>
          </div>
        </div>

        {/* Right Side: Material Governance Form */}
        <div className="flex-[4] min-w-[450px] max-w-[550px] flex flex-col bg-background/50 shrink-0">
          <div className="px-6 py-5 border-b border-border bg-muted/20 flex items-center justify-between">
            <h3 className="font-bold text-lg flex items-center gap-2 text-gray-800">
              <Shield className="w-5 h-5 text-cyan-500" />
              素材治理详情
            </h3>
            <Badge
              variant="outline"
              className="bg-cyan-50 text-cyan-600 border-cyan-200"
            >
              {file.assetType.toUpperCase()}
            </Badge>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8 custom-scrollbar">
            {/* Basic Info Group */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                <FileText className="w-3.5 h-3.5" /> 基础属性
              </div>
              <div className="grid gap-4 bg-muted/10 p-4 rounded-xl border border-border/50">
                <div className="space-y-2">
                  <Label
                    htmlFor="governance-name"
                    className="text-xs text-gray-500"
                  >
                    资源显示名称
                  </Label>
                  <Input
                    id="governance-name"
                    value={governanceData.name}
                    onChange={(e) =>
                      setGovernanceData({
                        ...governanceData,
                        name: e.target.value
                      })
                    }
                    className="h-9 bg-background border-gray-200"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-[10px] text-muted-foreground block">
                      文件大小
                    </span>
                    <span className="text-sm font-medium">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                  </div>
                  <div className="space-y-1 text-right">
                    <span className="text-[10px] text-muted-foreground block">
                      上传时间
                    </span>
                    <span className="text-sm font-medium">
                      {new Date(file.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Semantic Governance Group */}
            <div className="space-y-5">
              <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                <History className="w-3.5 h-3.5" /> 语义治理标签
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-gray-500 flex items-center gap-1.5">
                    <Calendar className="w-3 h-3" /> 历史时期
                  </Label>
                  <Select
                    value={governanceData.era || ''}
                    onChange={(e: any) =>
                      setGovernanceData({
                        ...governanceData,
                        era: e.target.value
                      })
                    }
                  >
                    <option value="">选择时期</option>
                    <option value="三国">三国时期</option>
                    <option value="二战">第二次世界大战</option>
                    <option value="冷战">冷战时期</option>
                    <option value="现代">现代战争</option>
                    <option value="未来">科幻未来</option>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-gray-500 flex items-center gap-1.5">
                    <Flag className="w-3 h-3" /> 所属阵营
                  </Label>
                  <Input
                    value={governanceData.faction}
                    onChange={(e) =>
                      setGovernanceData({
                        ...governanceData,
                        faction: e.target.value
                      })
                    }
                    placeholder="如：红方、蓝方"
                    className="h-9 bg-background"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-xs text-gray-500 flex items-center gap-1.5">
                  <Tag className="w-3 h-3" /> 战术语义标签
                </Label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {governanceData.tactics?.map((tag, i) => (
                    <Badge
                      key={i}
                      className="bg-orange-50 text-orange-600 border-orange-100 px-2 py-0.5 text-[10px] flex items-center gap-1"
                    >
                      {tag}
                      <X
                        className="w-2.5 h-2.5 cursor-pointer hover:text-orange-800"
                        onClick={() =>
                          setGovernanceData({
                            ...governanceData,
                            tactics: governanceData.tactics?.filter(
                              (_, idx) => idx !== i
                            )
                          })
                        }
                      />
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newTactic}
                    onChange={(e) => setNewTactic(e.target.value)}
                    placeholder="新增战术标签..."
                    className="h-8 text-xs"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddTactic()}
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8 shrink-0"
                    onClick={handleAddTactic}
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-xs text-gray-500 flex items-center gap-1.5">
                  <Activity className="w-3 h-3" /> 功能语义标签
                </Label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {governanceData.functions?.map((tag, i) => (
                    <Badge
                      key={i}
                      className="bg-indigo-50 text-indigo-600 border-indigo-100 px-2 py-0.5 text-[10px] flex items-center gap-1"
                    >
                      {tag}
                      <X
                        className="w-2.5 h-2.5 cursor-pointer hover:text-indigo-800"
                        onClick={() =>
                          setGovernanceData({
                            ...governanceData,
                            functions: governanceData.functions?.filter(
                              (_, idx) => idx !== i
                            )
                          })
                        }
                      />
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newFunction}
                    onChange={(e) => setNewFunction(e.target.value)}
                    placeholder="新增功能标签..."
                    className="h-8 text-xs"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddFunction()}
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8 shrink-0"
                    onClick={handleAddFunction}
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-gray-500">语义增强描述</Label>
                <Textarea
                  value={governanceData.description}
                  onChange={(e) =>
                    setGovernanceData({
                      ...governanceData,
                      description: e.target.value
                    })
                  }
                  placeholder="用自然语言描述资源用途，用于Embedding语义检索..."
                  className="min-h-[100px] bg-background text-xs resize-none leading-relaxed"
                />
              </div>

              <div className="space-y-3">
                <Label className="text-xs text-gray-500">
                  视觉复杂度等级 (1-5)
                </Label>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((level) => (
                    <button
                      key={level}
                      onClick={() =>
                        setGovernanceData({
                          ...governanceData,
                          visualLevel: level as any
                        })
                      }
                      className={cn(
                        'flex-1 h-8 rounded-md text-xs font-bold transition-all',
                        governanceData.visualLevel === level
                          ? 'bg-cyan-500 text-white shadow-md shadow-cyan-200'
                          : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                      )}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="px-6 py-5 border-t border-border bg-muted/10 flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-10 px-6 rounded-lg font-medium border-gray-200"
            >
              取消修改
            </Button>
            <Button
              onClick={handleSave}
              className="h-10 px-8 rounded-lg font-bold bg-cyan-500 hover:bg-cyan-600 shadow-md shadow-cyan-500/20 gap-2"
            >
              <Save className="w-4 h-4" />
              完成素材治理
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
