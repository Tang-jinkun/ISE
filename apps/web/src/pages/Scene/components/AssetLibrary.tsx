import { updateFile } from '@/api/file';
import { listFolders } from '@/api/folder';
import {
  FilePreviewModal,
  type MaterialGovernanceModel
} from '@/components/common/FilePreviewModal';
import { UploadDialog } from '@/components/common/UploadDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  Activity,
  ArrowRightLeft,
  AudioLines,
  Eye,
  Folder,
  Grid3x3,
  Image as ImageIcon,
  LayoutGrid,
  Map as MapIcon,
  Plus,
  RotateCw,
  Search,
  Video
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AddAssetModal } from './AddAssetModal';

export type AssetType =
  | 'folder'
  | 'image'
  | 'video'
  | 'audio'
  | 'geojson'
  | 'raster'
  | 'action';

export type AssetItem = {
  id: string;
  name: string;
  type: AssetType;
  thumb?: string;
  url?: string;
  mimeType?: string;
  size?: number;
  date?: string;
  tags?: string[];
};

interface AssetLibraryProps {
  tracks: any[];
  onAddAsset: (trackId: string, startTime: number, duration: number, asset: any) => void;
}

type CategoryId = 'all' | AssetType;

interface Category {
  id: CategoryId;
  label: string;
  icon: React.ElementType;
}

const categories: Category[] = [
  { id: 'all', label: '全部', icon: LayoutGrid },
  { id: 'image', label: '图片', icon: ImageIcon },
  { id: 'video', label: '视频', icon: Video },
  { id: 'audio', label: '音频', icon: AudioLines },
  { id: 'geojson', label: 'Geojson', icon: MapIcon },
  { id: 'raster', label: 'ImageRaster', icon: Grid3x3 },
  { id: 'action', label: 'Action动作', icon: Activity }
];

const ACTION_ITEMS: AssetItem[] = [
  {
    id: 'action-transfer',
    name: '视角转移',
    type: 'action',
    thumb: '',
    url: ''
  },
  {
    id: 'action-rotate',
    name: '视角旋转',
    type: 'action',
    thumb: '',
    url: ''
  }
];

const previewAssetTypes: Record<
  Exclude<AssetType, 'folder' | 'action'>,
  MaterialGovernanceModel['assetType']
> = {
  image: 'picture',
  video: 'video',
  audio: 'audio',
  geojson: 'geojson',
  raster: 'imageraster'
};

function previewAssetType(type: AssetType): MaterialGovernanceModel['assetType'] {
  if (type === 'folder' || type === 'action') {
    throw new Error(`Asset type ${type} cannot be previewed`);
  }
  return previewAssetTypes[type];
}

export function AssetLibrary({ tracks, onAddAsset }: AssetLibraryProps) {
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<
    { id: string | null; name: string }[]
  >([{ id: null, name: '全部文件' }]);
  const [activeCategory, setActiveCategory] = useState<CategoryId>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [addAssetModalOpen, setAddAssetModalOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<AssetItem | null>(null);
  const [previewFile, setPreviewFile] = useState<MaterialGovernanceModel | null>(
    null
  );

  useEffect(() => {
    loadAssets();
  }, [currentFolderId]);

  const loadAssets = async () => {
    try {
      const res = await listFolders({
        withFiles: true,
        parentId: currentFolderId || undefined
      });
      if (res.data) {
        const { folders: folderList = [], files: fileList = [] } = res.data;

        const mappedFolders: AssetItem[] = folderList.map((f: any) => ({
          id: f.id,
          name: f.name,
          type: 'folder',
          date: f.createdAt
        }));

        const mappedFiles: AssetItem[] = fileList.map((file: any) => {
          let type: AssetType = 'image';
          if (file.fileType?.startsWith('video/') || file.type === 'video')
            type = 'video';
          else if (file.fileType?.startsWith('audio/') || file.type === 'audio')
            type = 'audio';
          else if (
            file.fileType === 'application/json' ||
            file.fileType?.includes('geojson') ||
            file.type === 'geojson'
          )
            type = 'geojson';
          else if (file.fileType === 'image/tiff' || file.type === 'tif')
            type = 'raster';
          else if (file.type === 'image') type = 'image';

          return {
            id: file.id,
            name: file.name,
            type,
            url: file.url,
            mimeType: file.fileType,
            size: file.size,
            date: file.createdAt,
            tags: file.tags
          };
        });
        setAssets([...mappedFolders, ...mappedFiles]);
      }
    } catch (error) {
      console.error('Failed to load assets:', error);
    }
  };

  const handleEnterFolder = (folder: AssetItem) => {
    setCurrentFolderId(folder.id);
    setBreadcrumbs([...breadcrumbs, { id: folder.id, name: folder.name }]);
  };

  const handleBreadcrumbClick = (index: number) => {
    const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(newBreadcrumbs);
    setCurrentFolderId(newBreadcrumbs[index].id);
  };

  const filteredAssets = useMemo(() => {
    if (activeCategory === 'action') {
      return ACTION_ITEMS;
    }

    return assets.filter((asset) => {
      const matchesCategory =
        activeCategory === 'all' || asset.type === activeCategory;
      const matchesSearch = asset.name
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [assets, activeCategory, searchQuery]);

  const bytesToSize = (size?: number) => {
    if (!size || size <= 0) return '-';
    const i = Math.floor(Math.log(size) / Math.log(1024));
    const num = (size / Math.pow(1024, i)).toFixed(1);
    const unit = ['B', 'KB', 'MB', 'GB', 'TB'][i] || 'B';
    return `${num} ${unit}`;
  };

  const handleSaveFile = async (
    id: string,
    data: Partial<MaterialGovernanceModel>
  ) => {
    try {
      await updateFile(id, { name: data.name });
      await loadAssets();
    } catch (error) {
      console.error('Failed to update file:', error);
      throw error;
    }
  };

  const handleAddAsset = (asset: AssetItem) => {
    setSelectedAsset(asset);
    setAddAssetModalOpen(true);
  };

  const onConfirmAdd = (trackId: string, startTime: number, duration: number) => {
    if (selectedAsset) {
      onAddAsset(trackId, startTime, duration, selectedAsset);
    }
  };

  return (
    <aside className="w-80 border-r border-border bg-card flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Folder className="w-3.5 h-3.5" />
          <span>素材栏</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
          onClick={() => setUploadOpen(true)}
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Classification Sidebar */}
        <div className="w-12 border-r border-border bg-muted/30 flex flex-col items-center py-3 gap-2">
          {categories.map((category) => (
            <Button
              key={category.id}
              variant={activeCategory === category.id ? 'secondary' : 'ghost'}
              size="icon"
              className={cn(
                'h-9 w-9 rounded-lg',
                activeCategory === category.id && 'bg-background shadow-sm'
              )}
              title={category.label}
              onClick={() => setActiveCategory(category.id)}
            >
              <category.icon className="w-4 h-4" />
            </Button>
          ))}
        </div>

        {/* Asset List Area */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-3 py-3 border-b border-border space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="搜索素材..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 pl-8 text-xs bg-background"
              />
            </div>
            <div className="flex gap-2 text-[11px]">
              <button className="flex-1 rounded-lg bg-accent border border-border px-2 py-1 text-foreground">
                我的素材
              </button>
              <button className="flex-1 rounded-lg bg-card border border-border px-2 py-1 text-muted-foreground hover:text-foreground">
                公共素材
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1 px-3 py-2 text-xs text-muted-foreground border-b border-border bg-muted/20">
            {breadcrumbs.map((bc, index) => (
              <div key={bc.id ?? 'root'} className="flex items-center gap-1">
                {index > 0 && (
                  <span className="text-muted-foreground/50">/</span>
                )}
                <button
                  type="button"
                  onClick={() => handleBreadcrumbClick(index)}
                  className={cn(
                    'hover:text-cyan-500 transition-colors',
                    index === breadcrumbs.length - 1 &&
                      'text-cyan-500 cursor-default hover:text-cyan-500 font-medium'
                  )}
                >
                  {bc.name}
                </button>
              </div>
            ))}
          </div>

          <ScrollArea className="flex-1">
            <div className="p-3 space-y-3">
              {filteredAssets.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground">
                  暂无素材
                </div>
              ) : (
                filteredAssets.map((item) => (
                  <div
                    key={item.id}
                    draggable={item.type !== 'folder'}
                    onDragStart={(e) => {
                      if (item.type !== 'folder') {
                        e.dataTransfer.setData(
                          'application/json',
                          JSON.stringify(item)
                        );
                        e.dataTransfer.effectAllowed = 'copy';
                      } else {
                        e.preventDefault();
                      }
                    }}
                    onClick={() => {
                      if (item.type === 'folder') {
                        handleEnterFolder(item);
                      }
                    }}
                    className={cn(
                      'group relative flex gap-2 rounded-xl border border-border bg-card overflow-hidden hover:border-cyan-500/40 transition-colors',
                      item.type === 'folder' &&
                        'cursor-pointer hover:bg-accent/50'
                    )}
                  >
                    <div className="w-16 h-12 bg-muted flex items-center justify-center overflow-hidden shrink-0">
                      {item.type === 'action' ? (
                        item.id === 'action-transfer' ? (
                          <ArrowRightLeft className="w-6 h-6 text-muted-foreground" />
                        ) : (
                          <RotateCw className="w-6 h-6 text-muted-foreground" />
                        )
                      ) : item.type === 'folder' ? (
                        <Folder className="w-6 h-6 text-yellow-500/80 fill-yellow-500/20" />
                      ) : item.type === 'image' && item.url ? (
                        <img
                          src={item.url}
                          alt={item.name}
                          className="w-full h-full object-cover transition-transform group-hover:scale-110"
                        />
                      ) : (
                        <div className="text-muted-foreground">
                          {item.type === 'video' && (
                            <Video className="w-5 h-5" />
                          )}
                          {item.type === 'audio' && (
                            <AudioLines className="w-5 h-5" />
                          )}
                          {item.type === 'geojson' && (
                            <MapIcon className="w-5 h-5" />
                          )}
                          {item.type === 'raster' && (
                            <Grid3x3 className="w-5 h-5" />
                          )}
                          {item.type === 'image' && (
                            <ImageIcon className="w-5 h-5" />
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 px-2 py-1.5 flex flex-col justify-between min-w-0">
                      <div className="text-xs text-foreground truncate font-medium">
                        {item.name}
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        {item.type === 'folder' && <span>文件夹</span>}
                        {item.type === 'image' && <span>底图</span>}
                        {item.type === 'video' && <span>视频</span>}
                        {item.type === 'audio' && <span>音频</span>}
                        {item.type === 'geojson' && <span>GeoJSON</span>}
                        {item.type === 'raster' && <span>ImageRaster</span>}
                        {item.type === 'action' && <span>动作</span>}
                      </div>
                    </div>

                    {/* Hover Actions */}
                    <div className="absolute inset-0 bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      {item.type !== 'action' && item.type !== 'folder' && (
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7 rounded-full bg-background hover:bg-accent"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewFile({
                              id: item.id,
                              name: item.name,
                              oldName: item.name,
                              src: item.url || '',
                              folderId: currentFolderId || '',
                              type: item.mimeType || item.type,
                              size: item.size || 0,
                              createdAt: item.date || new Date(0).toISOString(),
                              updatedAt: item.date || new Date(0).toISOString(),
                              userId: '',
                              assetType: previewAssetType(item.type)
                            });
                          }}
                          title="预览"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {item.type !== 'folder' && (
                        <Button
                          variant="default"
                          size="icon"
                          className="h-7 w-7 rounded-full"
                          title="添加"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddAsset(item);
                          }}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onSuccess={() => {
          loadAssets();
        }}
        folderId={currentFolderId}
      />
      <FilePreviewModal
        open={!!previewFile}
        onOpenChange={(open) => !open && setPreviewFile(null)}
        file={previewFile}
        onSave={previewFile?.type === 'action' ? undefined : handleSaveFile}
      />
      <AddAssetModal
        open={addAssetModalOpen}
        onOpenChange={setAddAssetModalOpen}
        assetItem={selectedAsset}
        tracks={tracks}
        onConfirm={onConfirmAdd}
      />
    </aside>
  );
}
