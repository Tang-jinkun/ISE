import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { FileJson, Check } from 'lucide-react';

export const SCENE_CONFIGS = [
  {
    id: 'hainan',
    name: '海南岛战例',
    file: '海南岛战例-完成版更正错误版.json',
    path: '@/mock/OLD/海南岛战例-完成版更正错误版.json'
  },
  {
    id: 'chibi',
    name: '火烧赤壁',
    file: '火烧赤壁.json',
    path: '@/mock/OLD/火烧赤壁.json'
  },
  {
    id: 'nuoman',
    name: '诺曼底登陆',
    file: '诺曼底登陆-完成版.json',
    path: '@/mock/OLD/诺曼底登陆-完成版.json'
  },
  {
    id: 'pearl_harbor',
    name: '偷袭珍珠港',
    file: '偷袭珍珠港.json',
    path: '@/mock/OLD/偷袭珍珠港.json'
  }
];

interface SceneConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentConfigId: string;
  onSelect: (configId: string) => void;
}

export function SceneConfigModal({
  open,
  onOpenChange,
  currentConfigId,
  onSelect,
}: SceneConfigModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-none text-gray-900 sm:max-w-[450px] p-0 overflow-hidden rounded-xl shadow-2xl">
        <DialogHeader className="p-6 pb-4 border-b border-gray-50 bg-gray-50/50">
          <DialogTitle className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <FileJson className="w-5 h-5 text-[#00bcd4]" />
            选择战例配置
          </DialogTitle>
        </DialogHeader>

        <div className="p-6">
          <div className="grid gap-3">
            {SCENE_CONFIGS.map((config) => (
              <button
                key={config.id}
                onClick={() => {
                  onSelect(config.id);
                  onOpenChange(false);
                }}
                className={cn(
                  "group w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left",
                  currentConfigId === config.id
                    ? "border-[#00bcd4] bg-[#00bcd4]/5 shadow-sm"
                    : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                )}
              >
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
                    currentConfigId === config.id ? "bg-[#00bcd4] text-white" : "bg-gray-100 text-gray-400 group-hover:bg-gray-200"
                  )}>
                    <FileJson className="w-5 h-5" />
                  </div>
                  <div>
                    <div className={cn(
                      "font-bold text-base transition-colors",
                      currentConfigId === config.id ? "text-[#00bcd4]" : "text-gray-700"
                    )}>
                      {config.name}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 truncate max-w-[200px]">
                      {config.file}
                    </div>
                  </div>
                </div>

                {currentConfigId === config.id && (
                  <div className="w-6 h-6 rounded-full bg-[#00bcd4] flex items-center justify-center">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            取消
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
