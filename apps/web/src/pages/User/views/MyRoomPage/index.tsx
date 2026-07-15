import { deleteFile, updateFile } from '@/api/file';
import { createFolder, deleteFolder, listFolders } from '@/api/folder';
import { Button } from '@/components/ui/button';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { message } from '@/components/ui/message';
import { cn } from '@/lib/utils';
import {
  CheckSquare,
  Download,
  FileText,
  Filter,
  Folder,
  Grid,
  Image as ImageIcon,
  List as ListIcon,
  MoreVertical,
  Plus,
  Search,
  Share2,
  Shield,
  Trash2,
  Upload,
  Video
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type Item = {
  id: string;
  name: string;
  type: 'folder' | 'image' | 'video' | 'audio' | 'geojson' | 'tif' | 'file';
  mimeType?: string;
  size?: string;
  date?: string;
  url?: string;
  tags?: string[];
  raw?: any;
};

import {
  FilePreviewModal,
  type MaterialGovernanceModel
} from '@/components/common/FilePreviewModal';
import { UploadDialog } from '@/components/common/UploadDialog';

const MOCK_GOVERNANCE_ITEMS: MaterialGovernanceModel[] = [
  {
    id: 'mock-v-1',
    name: '诺曼底登陆战役纪录片.mp4',
    oldName: 'pearl_harbor_doc.mp4',
    src: 'http://119.45.15.186/SceneCreater/file-list/getFileItemContent/6e5d94da-b2db-4edc-8417-9d1e29917027',
    folderId: '1',
    type: 'video/mp4',
    size: 45600000,
    createdAt: '2024-03-01T10:00:00Z',
    updatedAt: '2024-03-05T15:30:00Z',
    userId: 'user-1',
    assetType: 'video',
    era: '二战',
    faction: '多方',
    tactics: ['突袭', '航空作战'],
    functions: ['历史影像', '教育资料'],
    description:
      '1941年12月7日珍珠港袭击事件的珍贵历史影像资料，展示了第一波攻击的实况。',
    visualLevel: 4
  },
  {
    id: 'mock-a-1',
    name: '战地环境背景音.mp3',
    oldName: 'battlefield_ambient.mp3',
    src: 'https://www.w3schools.com/html/horse.mp3',
    folderId: '1',
    type: 'audio/mpeg',
    size: 5200000,
    createdAt: '2024-03-02T08:00:00Z',
    updatedAt: '2024-03-02T08:00:00Z',
    userId: 'user-1',
    assetType: 'audio',
    era: '现代',
    faction: '通用',
    tactics: ['心理战'],
    functions: ['背景音乐', '音效'],
    description:
      '模拟现代战场环境的音频素材，包含远处炮火声、无线电杂音和风声。',
    visualLevel: 2
  },
  {
    id: 'mock-p-1',
    name: '张池明肖像.png',
    oldName: 'yamamoto_portrait.png',
    src: 'http://119.45.15.186/SceneCreater/file-list/getFileItemContent/039149ee-1cc2-4c62-8b48-909622e2a30a',
    folderId: '1',
    type: 'image/png',
    size: 1200000,
    createdAt: '2024-03-03T12:00:00Z',
    updatedAt: '2024-03-03T12:00:00Z',
    userId: 'user-1',
    assetType: 'picture',
    era: '二战',
    faction: '日方',
    tactics: ['战略指挥'],
    functions: ['人物肖像'],
    description:
      '日本海军联合舰队司令长官山本五十六大将的半身像，用于指挥官介绍。',
    visualLevel: 3
  },
  {
    id: 'mock-g-1',
    name: '行军路线',
    oldName: 'oahu_defense.geojson',
    src: 'http://119.45.15.186/SceneCreater/file-list/getFileItemById/16778d10-420c-44a7-8093-6538ceebb8d8',
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [102.91347218485066, 31.029639500495747],
              [102.957484457612, 31.073838371041262],
              [102.96845423994017, 31.081788203859332],
              [102.99292529282627, 31.092627813478032],
              [103.04861803387541, 31.136696150602333],
              [103.09418482200425, 31.163416154578414],
              [103.14725897391861, 31.166698091233826],
              [103.20010255910933, 31.184508944400335],
              [103.24173689895548, 31.200946758202775],
              [103.30018510681771, 31.229021416773463],
              [103.34582274857206, 31.276250186408944],
              [103.39065972994626, 31.311827264992928],
              [103.45610321611622, 31.397534733047323],
              [103.53125795706666, 31.475488688572327],
              [103.64546369086304, 31.552122006369757],
              [103.69248397788135, 31.638951065599215],
              [103.75467376284456, 31.695781557756064],
              [103.84173946179277, 31.789865298863546],
              [103.89403827527377, 31.933783025194415],
              [103.94446775740266, 32.013229688679644],
              [103.9612838664313, 32.08892612987695],
              [103.96453612523243, 32.102702059712385]
            ]
          }
        }
      ]
    },
    folderId: '1',
    type: 'application/json',
    size: 850000,
    createdAt: '2024-03-04T09:00:00Z',
    updatedAt: '2024-03-04T09:00:00Z',
    userId: 'user-1',
    assetType: 'geojson',
    era: '现代战争',
    faction: '蓝方',
    tactics: ['阵地防御', '防空部署'],
    functions: ['矢量底图', '战位标注'],
    description:
      '1941年美军在欧胡岛的岸防炮台、防空雷达站及机场分布的矢量数据。',
    visualLevel: 5
  },
  {
    id: 'mock-r-1',
    name: '测试影像',
    oldName: 'pearl_harbor_dem.tif',
    src: 'http://119.45.15.186/SceneCreater/file-list/getFileItemContent/7c360527-80de-483a-a67a-09048f5d4700',
    folderId: '1',
    type: 'image/tiff',
    size: 125000000,
    createdAt: '2024-03-05T14:00:00Z',
    updatedAt: '2024-03-05T14:00:00Z',
    userId: 'user-1',
    assetType: 'imageraster',
    era: '现代',
    faction: '中立',
    functions: ['数字高程模型', '栅格底图'],
    description: '',
    visualLevel: 5,
    bbox: [120.123456789, 30.123456789, 121.654321098, 31.654321098] // Random "wrong" position for testing
  },
  {
    id: 'mock-s-1',
    name: '第一波攻击群符号',
    oldName: 'first_wave_symbol.svg',
    src: 'http://119.45.15.186/SceneCreater/file-list/getFileItemById/16778d10-420c-44a7-8093-6538ceebb8d8',
    data: {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [117.65582735246903, 27.231102607874035, 20.01],
            [117.60123453850065, 27.091471124083412, 20.01],
            [117.50335006582176, 26.849899313669642, 20.01],
            [117.46005840711129, 26.74795898704649, 20.01],
            [117.46005840711129, 26.74795898704649, 20.01],
            [117.38153020960296, 26.571771304217407, 20.01],
            [117.2821630047473, 26.357889107154946, 20.01],
            [117.25232110039843, 26.53373684941212, 20.01],
            [117.15529479936478, 26.148139901632547, 20.01],
            [117.50105711917212, 26.344475144089525, 20.01],
            [117.32361900787626, 26.32634548960118, 20.01],
            [117.34802264874423, 26.357598715533147, 20.01],
            [117.36808174343427, 26.383093816851765, 20.01],
            [117.36808174343427, 26.383093816851765, 20.01],
            [117.37511317730676, 26.392064442568625, 20.01],
            [117.38888377633552, 26.410388687437838, 20.01],
            [117.40232500591526, 26.42911222471846, 20.01],
            [117.41546059161317, 26.448168054731376, 20.01],
            [117.4346735788053, 26.47720768763394, 20.01],
            [117.45939559371637, 26.51650910790424, 20.01],
            [117.49511018984367, 26.575609797864704, 20.01],
            [117.52954776469156, 26.63300843921492, 20.01],
            [117.55222654555558, 26.66958658170882, 20.01],
            [117.56920474550876, 26.695647629543455, 20.01],
            [117.5805525014155, 26.712320591502028, 20.01],
            [117.59195049694819, 26.728320851006252, 20.01],
            [117.60342245767401, 26.74358140837703, 20.01],
            [117.61209284919215, 26.754474312648945, 20.01],
            [117.61790654616914, 26.761487002535073, 20.01],
            [117.62375208007597, 26.76827707956834, 20.01],
            [117.62963241660853, 26.77483616878886, 20.01],
            [117.6355505214627, 26.781155895236736, 20.01],
            [117.64150936033441, 26.787227883952085, 20.01],
            [117.6475118989195, 26.793043759975014, 20.01],
            [117.65356110291393, 26.798595148345637, 20.01],
            [117.65965993801359, 26.803873674104064, 20.01],
            [117.66581136991434, 26.808870962290413, 20.01],
            [117.6704630503786, 26.81242008153194, 20.01],
            [117.67358099426971, 26.81469994592115, 20.01],
            [117.67671375556505, 26.81690479000241, 20.01],
            [117.6798617049766, 26.819033566905716, 20.01],
            [117.68302521321635, 26.8210852297611, 20.01],
            [117.68620465099627, 26.823058731698563, 20.01],
            [117.68940038902836, 26.82495302584813, 20.01],
            [117.69261279802461, 26.8267670653398, 20.01],
            [117.695842248697, 26.8284998033036, 20.01],
            [117.69908911175753, 26.83015019286954, 20.01],
            [117.70235375791819, 26.831717187167627, 20.01],
            [117.70563655789093, 26.833199739327885, 20.01],
            [117.70893788238774, 26.83459680248033, 20.01],
            [117.71225810212067, 26.835907329754967, 20.01],
            [117.71559758780167, 26.837130274281805, 20.01],
            [117.71895671014272, 26.83826458919087, 20.01],
            [117.72233583985582, 26.839309227612176, 20.01],
            [117.72573534765294, 26.840263142675727, 20.01],
            [117.72915560424607, 26.841125287511545, 20.01],
            [117.73259698034724, 26.841894615249643, 20.01],
            [117.73605984666835, 26.842570079020028, 20.01],
            [117.73954457392148, 26.84315063195272, 20.01],
            [117.74305153281855, 26.843635227177735, 20.01],
            [117.74658109407159, 26.844022817825085, 20.01],
            [117.75013362839258, 26.844312357024776, 20.01],
            [117.75370950649346, 26.844502797906834, 20.01],
            [117.7573090990863, 26.84459309360127, 20.01],
            [117.76093277688301, 26.844582197238093, 20.01],
            [117.7627547903, 26.84453419312292, 20.01],
            [117.7627547903, 26.84453419312292, 20.01],
            [117.76451886615287, 26.844471595652685, 20.01],
            [117.76802627091311, 26.84426861585446, 20.01],
            [117.7715091016199, 26.84397313796547, 20.01],
            [117.77496771636345, 26.84358609947296, 20.01],
            [117.77840247323394, 26.8431084378642, 20.01],
            [117.78181373032152, 26.842541090626426, 20.01],
            [117.78520184571641, 26.841884995246907, 20.01],
            [117.78856717750877, 26.84114108921289, 20.01],
            [117.79191008378879, 26.84031031001164, 20.01],
            [117.79523092264664, 26.839393595130403, 20.01],
            [117.79853005217251, 26.838391882056435, 20.01],
            [117.8018078304566, 26.83730610827699, 20.01],
            [117.80506461558906, 26.836137211279333, 20.01],
            [117.80830076566006, 26.834886128550707, 20.01],
            [117.81151663875983, 26.833553797578375, 20.01],
            [117.81471259297851, 26.832141155849587, 20.01],
            [117.8178889864063, 26.830649140851598, 20.01],
            [117.82104617713338, 26.82907869007167, 20.01],
            [117.82418452324995, 26.827430740997045, 20.01],
            [117.82730438284615, 26.825706231114992, 20.01],
            [117.83040611401216, 26.823906097912754, 20.01],
            [117.83349007483821, 26.822031278877596, 20.01],
            [117.83655662341445, 26.820082711496767, 20.01],
            [117.83960611783107, 26.818061333257525, 20.01],
            [117.84263891617825, 26.81596808164712, 20.01],
            [117.84565537654615, 26.813803894152812, 20.01],
            [117.85015214705342, 26.81043523290313, 20.01],
            [117.85609133699586, 26.805692492458157, 20.01],
            [117.8619716206445, 26.80068288324815, 20.01],
            [117.86779586272081, 26.79541390517116, 20.01],
            [117.87356692794626, 26.789893058125223, 20.01],
            [117.87928768104226, 26.78412784200838, 20.01],
            [117.88496098673028, 26.778125756718673, 20.01],
            [117.89058970973176, 26.771894302154145, 20.01],
            [117.89617671476817, 26.765440978212823, 20.01],
            [117.90172486656095, 26.758773284792756, 20.01],
            [117.90723702983155, 26.75189872179199, 20.01],
            [117.91544766617636, 26.74123891783342, 20.01],
            [117.9262904382419, 26.726338573124124, 20.01],
            [117.93704082120483, 26.710745748256734, 20.01],
            [117.94772173283678, 26.694520442415556, 20.01],
            [117.96366449627718, 26.669188140420278, 20.01],
            [117.9848845048143, 26.633662633107097, 20.01],
            [118.01697304588009, 26.577896978811292, 20.01],
            [118.05008570650617, 26.52030645360174, 20.01],
            [118.07294430633976, 26.481861152826575, 20.01],
            [118.09667090942958, 26.443885887372325, 20.01],
            [118.11518293228649, 26.416042583282454, 20.01],
            [118.12786911956059, 26.39785747092843, 20.01],
            [118.13434464611808, 26.388923875268596, 20.01],
            [118.13434464611808, 26.388923875268596, 20.01],
            [118.15305891613063, 26.36312376473227, 20.01],
            [118.17577221121778, 26.331467768532125, 20.01],
            [118.00228075369573, 26.356221542289624, 20.01],
            [118.3340417384336, 26.14991469354205, 20.01],
            [118.2538986041334, 26.532282245589727, 20.01],
            [118.21770851962404, 26.36081121908214, 20.01],
            [118.12847460473316, 26.574665227564648, 20.01],
            [118.05834646488877, 26.750739825987655, 20.01],
            [118.05834646488877, 26.750739825987655, 20.01],
            [118.01985380486072, 26.852814660740005, 20.01],
            [117.93343868859684, 27.09458178409445, 20.01],
            [117.885516232361, 27.234274072696536, 20.01]
          ]
        ]
      },
      properties: {
        node_id: 'node_20',
        line_color: 'rgb(255,0,0)',
        line_type: 2,
        line_width: 2,
        line_opacity: 1
      }
    },
    folderId: '1',
    type: 'image/svg+xml',
    size: 45000,
    createdAt: '2024-03-06T11:00:00Z',
    updatedAt: '2024-03-06T11:00:00Z',
    userId: 'user-1',
    assetType: 'plotsymbol',
    era: '现代战争',
    faction: '红方',
    tactics: ['空中突击'],
    functions: ['态势符号', '军事标绘'],
    description:
      '标准化的军事标绘符号，代表由俯冲轰炸机和鱼雷机组成的第一波攻击集群。',
    visualLevel: 3,
    coordinates: [-157.95, 21.35] // Pearl Harbor coordinates
  }
];

export default function MyRoomPage() {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [filterType, setFilterType] = useState<
    'all' | 'folder' | 'image' | 'video' | 'file'
  >('all');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<
    { id: string | null; name: string }[]
  >([{ id: null, name: '全部文件' }]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFile, setPreviewFile] =
    useState<MaterialGovernanceModel | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    item: Item | null;
  }>({ open: false, x: 0, y: 0, item: null });

  const [dragItem, setDragItem] = useState<Item | null>(null);
  const [dropTarget, setDropTarget] = useState<Item | null>(null);
  const [moveConfirmOpen, setMoveConfirmOpen] = useState(false);

  const loadItems = async () => {
    try {
      const res = await listFolders({
        withFiles: true,
        parentId: currentFolderId || undefined
      });
      if (res.data) {
        const { folders: folderList = [], files: fileList = [] } = res.data;

        const mappedFolders: Item[] = folderList.map((f: any) => ({
          id: f.id,
          name: f.name,
          type: 'folder',
          date: new Date(f.createdAt).toLocaleDateString(),
          size: '-'
        }));

        const mappedFiles: Item[] = fileList.map((file: any) => {
          let type: Item['type'] = 'file';
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
            type = 'tif';
          else if (file.fileType?.startsWith('image/') || file.type === 'image')
            type = 'image';

          return {
            id: file.id,
            name: file.name,
            type,
            url: file.url,
            mimeType: file.fileType,
            size: bytesToSize(file.size),
            date: new Date(file.createdAt).toLocaleDateString(),
            tags: file.tags,
            raw: file
          };
        });
        setItems([...mappedFolders, ...mappedFiles]);
      }
    } catch (error) {
      console.error('Failed to load items:', error);
    }
  };

  useEffect(() => {
    loadItems();
  }, [currentFolderId]);

  const bytesToSize = (size?: number) => {
    if (!size || size <= 0) return '-';
    const i = Math.floor(Math.log(size) / Math.log(1024));
    const num = (size / Math.pow(1024, i)).toFixed(1);
    const unit = ['B', 'KB', 'MB', 'GB', 'TB'][i] || 'B';
    return `${num}${unit}`;
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (filterType === 'all') return true;
      return item.type === filterType;
    });
  }, [items, filterType]);

  const handleEnterFolder = (folder: Item) => {
    setCurrentFolderId(folder.id);
    setBreadcrumbs([...breadcrumbs, { id: folder.id, name: folder.name }]);
  };

  const handleBreadcrumbClick = (index: number) => {
    const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(newBreadcrumbs);
    setCurrentFolderId(newBreadcrumbs[index].id);
  };

  const handleOpenGovernance = (item: Item) => {
    if (item.type === 'folder') return;

    let mockItem: MaterialGovernanceModel | undefined;
    if (item.type === 'video')
      mockItem = MOCK_GOVERNANCE_ITEMS.find((m) => m.assetType === 'video');
    else if (item.type === 'audio')
      mockItem = MOCK_GOVERNANCE_ITEMS.find((m) => m.assetType === 'audio');
    else if (item.type === 'geojson')
      mockItem = MOCK_GOVERNANCE_ITEMS.find((m) => m.assetType === 'geojson');
    else if (item.type === 'tif')
      mockItem = MOCK_GOVERNANCE_ITEMS.find(
        (m) => m.assetType === 'imageraster'
      );
    else if (item.name.includes('符号'))
      mockItem = MOCK_GOVERNANCE_ITEMS.find(
        (m) => m.assetType === 'plotsymbol'
      );
    else
      mockItem = MOCK_GOVERNANCE_ITEMS.find((m) => m.assetType === 'picture');

    if (mockItem) {
      setPreviewFile({
        ...mockItem,
        id: item.id,
        name: item.name,
        src: item.url || mockItem.src,
        size: item.raw?.size || 0,
        createdAt: item.raw?.createdAt || mockItem.createdAt
      });
      setPreviewOpen(true);
    }
  };

  const handleSaveGovernance = async (
    id: string,
    data: Partial<MaterialGovernanceModel>
  ) => {
    try {
      await updateFile(id, { name: data.name });
      message.success('治理信息已模拟保存');
      loadItems();
    } catch (e) {
      console.error(e);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedFiles((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    if (selectedFiles.length === items.length) {
      setSelectedFiles([]);
    } else {
      setSelectedFiles(items.map((i) => i.id));
    }
  };

  const handleDelete = async (item: Item) => {
    try {
      if (item.type === 'folder') {
        await deleteFolder(item.id);
      } else {
        await deleteFile(item.id);
      }
      message.success('删除成功');
      loadItems();
    } catch {
      message.error('删除失败');
    }
    setContextMenu({ ...contextMenu, open: false });
  };

  const handleDragStart = (e: React.DragEvent, item: Item) => {
    setDragItem(item);
  };

  const handleDragOver = (e: React.DragEvent, item: Item) => {
    e.preventDefault();
    if (item.type === 'folder' && dragItem?.id !== item.id) {
      setDropTarget(item);
    }
  };

  const handleDrop = (e: React.DragEvent, item: Item) => {
    e.preventDefault();
    if (item.type === 'folder' && dragItem && dragItem.id !== item.id) {
      setMoveConfirmOpen(true);
    }
  };

  const confirmMove = async () => {
    if (!dragItem || !dropTarget) return;
    try {
      await updateFile(dragItem.id, { folderId: dropTarget.id });
      message.success('移动成功');
      loadItems();
    } catch {
      message.error('移动失败');
    }
    setMoveConfirmOpen(false);
  };

  const handleContextMenu = (e: React.MouseEvent, item: Item) => {
    e.preventDefault();
    setContextMenu({
      open: true,
      x: e.clientX,
      y: e.clientY,
      item
    });
  };

  const handleOpenPreview = (item: Item) => {
    handleOpenGovernance(item);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 text-foreground">
      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onSuccess={() => loadItems()}
        folderId={currentFolderId}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-background border-border text-foreground">
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              输入文件夹名称
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">名称</Label>
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="未命名文件夹"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                onClick={async () => {
                  if (!newFolderName.trim()) {
                    message.info('请输入名称');
                    return;
                  }
                  try {
                    await createFolder({ name: newFolderName.trim() });
                    message.success('创建成功');
                    setCreateOpen(false);
                    setNewFolderName('');
                    await loadItems();
                  } catch {
                    message.error('创建失败');
                  }
                }}
                className="bg-cyan-600 hover:bg-cyan-700"
              >
                确定
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* Header / Toolbar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500">
            我的空间
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            管理您的个人资源文件
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          {/* Search */}
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索文件..."
              className="w-full bg-muted/50 border border-border rounded-lg pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-cyan-500/50 transition-all"
            />
          </div>

          {/* View Toggle */}
          <div className="flex bg-muted/50 border border-border rounded-lg p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                'p-1.5 rounded-md transition-all',
                viewMode === 'grid'
                  ? 'bg-background shadow-sm text-cyan-500'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'p-1.5 rounded-md transition-all',
                viewMode === 'list'
                  ? 'bg-background shadow-sm text-cyan-500'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <ListIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center text-sm text-muted-foreground gap-1">
        {breadcrumbs.map((bc, index) => (
          <div key={bc.id ?? 'root'} className="flex items-center gap-1">
            {index > 0 && <span className="text-muted-foreground/50">/</span>}
            <button
              type="button"
              onClick={() => handleBreadcrumbClick(index)}
              className={cn(
                'hover:text-cyan-500',
                index === breadcrumbs.length - 1 &&
                  'text-cyan-500 cursor-default hover:text-cyan-500'
              )}
            >
              {index === 0 ? '全部文件' : bc.name}
            </button>
          </div>
        ))}
      </div>

      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-card/50 border border-border rounded-xl backdrop-blur-sm shadow-sm">
        <div className="flex items-center gap-3">
          <Button
            className="bg-cyan-600 hover:bg-cyan-700 text-white gap-2"
            onClick={() => setUploadOpen(true)}
          >
            <Upload className="w-4 h-4" />
            上传文件
          </Button>
          <Button
            variant="outline"
            className="border-border text-muted-foreground hover:text-foreground hover:bg-accent gap-2"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="w-4 h-4" />
            新建文件夹
          </Button>
          {/* 治理预览按钮 */}
          {/* <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="border-cyan-200 text-cyan-600 hover:text-cyan-700 hover:bg-cyan-50 gap-2 shadow-sm"
              >
                <Shield className="w-4 h-4" />
                治理预览
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-popover border-border">
              {MOCK_GOVERNANCE_ITEMS.map((mock) => (
                <DropdownMenuItem
                  key={mock.id}
                  className="hover:bg-cyan-50 hover:text-cyan-600 cursor-pointer flex items-center gap-2"
                  onClick={() => {
                    setPreviewFile(mock);
                    setPreviewOpen(true);
                  }}
                >
                  {mock.assetType === 'video' && (
                    <Video className="w-3.5 h-3.5" />
                  )}
                  {mock.assetType === 'audio' && (
                    <Music className="w-3.5 h-3.5" />
                  )}
                  {mock.assetType === 'picture' && (
                    <ImageIcon className="w-3.5 h-3.5" />
                  )}
                  {mock.assetType === 'geojson' && (
                    <MapIcon className="w-3.5 h-3.5" />
                  )}
                  {mock.assetType === 'imageraster' && (
                    <Layers className="w-3.5 h-3.5" />
                  )}
                  {mock.assetType === 'plotsymbol' && (
                    <Activity className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {mock.assetType === 'video' && '视频治理'}
                    {mock.assetType === 'audio' && '音频治理'}
                    {mock.assetType === 'picture' && '图片治理'}
                    {mock.assetType === 'geojson' && '矢量数据治理'}
                    {mock.assetType === 'imageraster' && '栅格数据治理'}
                    {mock.assetType === 'plotsymbol' && '态势符号治理'}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu> */}

          <div className="h-6 w-px bg-border mx-2" />

          <Button
            variant="ghost"
            className={cn(
              'gap-2',
              isMultiSelectMode
                ? 'text-cyan-500 bg-cyan-500/10'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => {
              setIsMultiSelectMode(!isMultiSelectMode);
              setSelectedFiles([]);
            }}
          >
            <CheckSquare className="w-4 h-4" />
            {isMultiSelectMode ? '退出多选' : '批量管理'}
          </Button>

          {isMultiSelectMode && (
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              onClick={selectAll}
            >
              全选
            </Button>
          )}
        </div>

        {/* Filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-foreground gap-2"
            >
              <Filter className="w-4 h-4" />
              筛选
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="bg-popover border-border text-popover-foreground"
          >
            <DropdownMenuItem
              className="hover:bg-accent hover:text-accent-foreground cursor-pointer"
              onClick={() => setFilterType('all')}
            >
              全部类型
            </DropdownMenuItem>
            <DropdownMenuItem
              className="hover:bg-accent hover:text-accent-foreground cursor-pointer"
              onClick={() => setFilterType('folder')}
            >
              文件夹
            </DropdownMenuItem>
            <DropdownMenuItem
              className="hover:bg-accent hover:text-accent-foreground cursor-pointer"
              onClick={() => setFilterType('image')}
            >
              图片
            </DropdownMenuItem>
            <DropdownMenuItem
              className="hover:bg-accent hover:text-accent-foreground cursor-pointer"
              onClick={() => setFilterType('video')}
            >
              视频
            </DropdownMenuItem>
            <DropdownMenuItem
              className="hover:bg-accent hover:text-accent-foreground cursor-pointer"
              onClick={() => setFilterType('file')}
            >
              文档
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Bulk Actions Bar (Visible when items selected) */}
      {selectedFiles.length > 0 && (
        <div className="flex items-center gap-4 px-4 py-2 bg-cyan-500/10 border border-cyan-500/20 rounded-lg animate-in slide-in-from-top-2">
          <span className="text-sm text-cyan-600 dark:text-cyan-400">
            已选择 {selectedFiles.length} 项
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              <Share2 className="w-4 h-4 mr-2" /> 分享
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              <Download className="w-4 h-4 mr-2" /> 下载
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-400 hover:text-red-500 hover:bg-red-500/10"
            >
              <Trash2 className="w-4 h-4 mr-2" /> 删除
            </Button>
          </div>
        </div>
      )}

      {/* File List / Grid */}
      <div
        className={cn(
          'grid gap-4',
          viewMode === 'grid'
            ? 'grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
            : 'grid-cols-1'
        )}
      >
        {filteredItems.map((file) => (
          <div
            key={file.id}
            draggable
            onDragStart={(e) => handleDragStart(e, file)}
            onDragOver={(e) => handleDragOver(e, file)}
            onDrop={(e) => handleDrop(e, file)}
            onContextMenu={(e) => handleContextMenu(e, file)}
            onClick={() => {
              if (isMultiSelectMode) {
                toggleSelect(file.id);
              } else if (file.type === 'folder') {
                handleEnterFolder(file);
              } else {
                handleOpenPreview(file);
              }
            }}
            className={cn(
              'group relative bg-card border border-border rounded-xl overflow-hidden cursor-pointer transition-all hover:bg-accent/50 hover:shadow-md',
              selectedFiles.includes(file.id)
                ? 'border-cyan-500 bg-cyan-500/5'
                : 'hover:border-primary/20',
              dropTarget?.id === file.id &&
                'border-2 border-dashed border-cyan-500 bg-cyan-500/10',
              viewMode === 'list' && 'flex items-center p-3 gap-4'
            )}
          >
            {/* Selection Checkbox */}
            {(isMultiSelectMode || selectedFiles.includes(file.id)) && (
              <div
                className={cn(
                  'absolute top-2 left-2 z-10',
                  viewMode === 'list' && 'relative top-0 left-0'
                )}
              >
                <div
                  className={cn(
                    'w-5 h-5 rounded border flex items-center justify-center transition-colors',
                    selectedFiles.includes(file.id)
                      ? 'bg-cyan-500 border-cyan-500'
                      : 'bg-muted/80 border-border hover:border-foreground/50'
                  )}
                >
                  {selectedFiles.includes(file.id) && (
                    <CheckSquare className="w-3.5 h-3.5 text-white" />
                  )}
                </div>
              </div>
            )}

            {/* Icon / Preview */}
            <div
              className={cn(
                'flex items-center justify-center',
                viewMode === 'grid'
                  ? 'aspect-square w-full border-b border-border bg-muted/30'
                  : 'w-10 h-10 rounded-lg bg-muted/30'
              )}
            >
              {file.type === 'folder' ? (
                <Folder
                  className={cn(
                    'text-yellow-500 fill-yellow-500',
                    viewMode === 'grid' ? 'w-16 h-16' : 'w-6 h-6'
                  )}
                />
              ) : file.type === 'image' ? (
                <ImageIcon
                  className={cn(
                    'text-purple-500',
                    viewMode === 'grid' ? 'w-12 h-12' : 'w-6 h-6'
                  )}
                />
              ) : file.type === 'video' ? (
                <Video
                  className={cn(
                    'text-red-500',
                    viewMode === 'grid' ? 'w-12 h-12' : 'w-6 h-6'
                  )}
                />
              ) : (
                <FileText
                  className={cn(
                    'text-blue-500',
                    viewMode === 'grid' ? 'w-12 h-12' : 'w-6 h-6'
                  )}
                />
              )}
            </div>

            {/* Info */}
            <div
              className={cn(
                'p-3',
                viewMode === 'list' &&
                  'flex-1 flex items-center justify-between p-0'
              )}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground truncate group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">
                  {file.name}
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                  <span>{file.date}</span>
                  {viewMode === 'list' && (
                    <>
                      <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
                      <span>{file.size}</span>
                    </>
                  )}
                </div>
              </div>

              {viewMode === 'grid' && (
                <div className="mt-2 text-xs text-muted-foreground flex justify-between items-center">
                  <span>{file.size}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="物料治理"
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-cyan-500/10 hover:text-cyan-600 rounded transition-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenGovernance(file);
                      }}
                    >
                      <Shield className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-accent rounded transition-all"
                    >
                      <MoreVertical className="w-3 h-3 text-muted-foreground" />
                    </button>
                  </div>
                </div>
              )}

              {viewMode === 'list' && (
                <div className="flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-opacity px-4">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-cyan-500 hover:text-cyan-600 hover:bg-cyan-500/10"
                    title="物料治理"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenGovernance(file);
                    }}
                  >
                    <Shield className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                  >
                    <Share2 className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-red-400 hover:text-red-500"
                    onClick={async () => {
                      try {
                        if (file.type === 'folder') {
                          await deleteFolder(file.id);
                        } else {
                          await deleteFile(file.id);
                        }
                        message.success('删除成功');
                        await loadItems();
                      } catch {
                        message.error('删除失败');
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Upload Dropzone (Grid View Only) */}
        {viewMode === 'grid' && !isMultiSelectMode && (
          <div
            className="border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center aspect-square text-muted-foreground hover:border-cyan-500/50 hover:text-cyan-600 dark:hover:text-cyan-400 hover:bg-cyan-500/5 transition-all cursor-pointer group"
            onClick={() => setUploadOpen(true)}
          >
            <Upload className="w-8 h-8 mb-2 group-hover:scale-110 transition-transform" />
            <span className="text-sm font-medium">点击上传</span>
          </div>
        )}
      </div>
      {/* Context Menu */}
      {contextMenu.open && (
        <div
          className="fixed z-50 min-w-[160px] bg-popover border border-border rounded-md shadow-md p-1 animate-in fade-in zoom-in-95"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="flex items-center gap-2 px-2 py-1.5 text-sm text-red-500 hover:bg-red-500/10 rounded-sm cursor-pointer"
            onClick={() => {
              if (contextMenu.item) handleDelete(contextMenu.item);
            }}
          >
            <Trash2 className="w-4 h-4" />
            删除
          </div>
        </div>
      )}

      {/* Move Confirmation Modal */}
      <Dialog open={moveConfirmOpen} onOpenChange={setMoveConfirmOpen}>
        <DialogContent className="bg-background text-foreground border-border">
          <DialogHeader>
            <DialogTitle>移动确认</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              确定要将 "{dragItem?.name}" 移动到 "{dropTarget?.name}" 吗？
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setMoveConfirmOpen(false)}>
              取消
            </Button>
            <Button
              className="bg-cyan-600 hover:bg-cyan-700"
              onClick={confirmMove}
            >
              确定
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <FilePreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        file={previewFile}
        onSave={handleSaveGovernance}
      />
    </div>
  );
}
