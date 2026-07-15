import { useState } from 'react';
import {
  Share2,
  Download,
  ExternalLink,
  Copy,
  MoreVertical,
  Clock,
  FileText,
  Film,
  Search,
  Filter,
  Trash2,
  Eye
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown';

type ShareItem = {
  id: string;
  name: string;
  type: 'scenario' | 'script' | 'folder';
  createdAt: string;
  status: 'active' | 'expired';
  views?: number;
  url?: string; // For my shares
  sender?: string; // For received shares
  permission?: 'read' | 'edit';
};

const MY_SHARES: ShareItem[] = [
  {
    id: '1',
    name: '城市突击作战场景 v1.0',
    type: 'scenario',
    createdAt: '2023-10-24 14:30',
    status: 'active',
    views: 128,
    url: 'https://app.example.com/s/xk9s8d'
  },
  {
    id: '2',
    name: '无人机集群控制脚本',
    type: 'script',
    createdAt: '2023-10-22 09:15',
    status: 'active',
    views: 45,
    url: 'https://app.example.com/s/m2k39d'
  },
  {
    id: '3',
    name: '过往训练数据集',
    type: 'folder',
    createdAt: '2023-09-15 11:20',
    status: 'expired',
    views: 12,
    url: 'https://app.example.com/s/p9l2xs'
  }
];

const RECEIVED_SHARES: ShareItem[] = [
  {
    id: '4',
    name: '海岛防御部署方案',
    type: 'scenario',
    createdAt: '2023-10-25 16:45',
    status: 'active',
    sender: '张三 (指挥官)',
    permission: 'read'
  },
  {
    id: '5',
    name: '红蓝对抗演练记录',
    type: 'script',
    createdAt: '2023-10-20 10:00',
    status: 'active',
    sender: '李四 (分析员)',
    permission: 'edit'
  }
];

export default function ShareManage() {
  const [activeTab, setActiveTab] = useState<'my_shares' | 'received'>(
    'my_shares'
  );

  const getIcon = (type: string) => {
    switch (type) {
      case 'scenario':
        return <Film className="w-5 h-5 text-cyan-400" />;
      case 'script':
        return <FileText className="w-5 h-5 text-green-400" />;
      case 'folder':
        return <Share2 className="w-5 h-5 text-yellow-400" />;
      default:
        return <FileText className="w-5 h-5 text-gray-400" />;
    }
  };

  return (
    <div className="h-full flex flex-col space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">分享管理</h1>
        <p className="text-muted-foreground">
          查看和管理您的所有分享链接以及收到的共享内容。
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="bg-card p-1 rounded-lg inline-flex border border-border/50">
          <button
            onClick={() => setActiveTab('my_shares')}
            className={cn(
              'px-6 py-2 rounded-md text-sm font-medium transition-all duration-200',
              activeTab === 'my_shares'
                ? 'bg-accent text-accent-foreground text-foreground shadow-lg'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            我的分享
          </button>
          <button
            onClick={() => setActiveTab('received')}
            className={cn(
              'px-6 py-2 rounded-md text-sm font-medium transition-all duration-200',
              activeTab === 'received'
                ? 'bg-accent text-accent-foreground text-foreground shadow-lg'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            接受的分享
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索分享..."
              className="bg-card border border-border rounded-lg pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-cyan-500/50 w-64"
            />
          </div>
          <button className="p-2 rounded-lg bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-accent text-accent-foreground transition-colors">
            <Filter className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 bg-card border border-border/50 rounded-2xl overflow-hidden flex flex-col">
        <div className="grid grid-cols-12 gap-4 p-4 border-b border-border/50 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <div className="col-span-5 pl-2">名称 / 类型</div>
          <div className="col-span-3">
            {activeTab === 'my_shares' ? '链接信息' : '分享人'}
          </div>
          <div className="col-span-2">状态 / 权限</div>
          <div className="col-span-2 text-right pr-2">操作</div>
        </div>

        <div className="overflow-y-auto flex-1">
          {(activeTab === 'my_shares' ? MY_SHARES : RECEIVED_SHARES).map(
            (item) => (
              <div
                key={item.id}
                className="group grid grid-cols-12 gap-4 p-4 items-center border-b border-border/50 hover:bg-accent transition-colors"
              >
                <div className="col-span-5 flex items-center gap-4 pl-2">
                  <div className="w-10 h-10 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0">
                    {getIcon(item.type)}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-foreground truncate group-hover:text-cyan-400 transition-colors">
                      {item.name}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      <span className="capitalize">
                        {item.type === 'scenario'
                          ? '场景'
                          : item.type === 'script'
                          ? '脚本'
                          : '文件夹'}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {item.createdAt}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="col-span-3">
                  {activeTab === 'my_shares' ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted px-2 py-1 rounded w-fit max-w-full">
                        <ExternalLink className="w-3 h-3 shrink-0" />
                        <span className="truncate">{item.url}</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Eye className="w-3 h-3" />
                        {item.views} 次查看
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center text-[10px] font-bold">
                        {item.sender?.[0]}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {item.sender}
                      </span>
                    </div>
                  )}
                </div>

                <div className="col-span-2">
                  {activeTab === 'my_shares' ? (
                    <span
                      className={cn(
                        'text-xs px-2 py-0.5 rounded-full border',
                        item.status === 'active'
                          ? 'text-green-400 border-green-500/20 bg-green-500/10'
                          : 'text-muted-foreground border-muted bg-muted/20'
                      )}
                    >
                      {item.status === 'active' ? '有效期内' : '已过期'}
                    </span>
                  ) : (
                    <span
                      className={cn(
                        'text-xs px-2 py-0.5 rounded-full border',
                        item.permission === 'edit'
                          ? 'text-cyan-400 border-cyan-500/20 bg-cyan-500/10'
                          : 'text-muted-foreground border-muted bg-muted/20'
                      )}
                    >
                      {item.permission === 'edit' ? '可编辑' : '仅查看'}
                    </span>
                  )}
                </div>

                <div className="col-span-2 flex justify-end pr-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent outline-none transition-colors">
                      <MoreVertical className="w-4 h-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-36">
                      {activeTab === 'my_shares' ? (
                        <>
                          <DropdownMenuItem>
                            <Copy className="w-4 h-4 mr-2" />
                            复制链接
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Share2 className="w-4 h-4 mr-2" />
                            编辑分享
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-red-400 focus:text-red-400 focus:bg-red-500/10">
                            <Trash2 className="w-4 h-4 mr-2" />
                            取消分享
                          </DropdownMenuItem>
                        </>
                      ) : (
                        <>
                          <DropdownMenuItem>
                            <ExternalLink className="w-4 h-4 mr-2" />
                            打开项目
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Download className="w-4 h-4 mr-2" />
                            转存副本
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-red-400 focus:text-red-400 focus:bg-red-500/10">
                            <Trash2 className="w-4 h-4 mr-2" />
                            移除记录
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            )
          )}

          {((activeTab === 'my_shares' && MY_SHARES.length === 0) ||
            (activeTab === 'received' && RECEIVED_SHARES.length === 0)) && (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <Share2 className="w-12 h-12 mb-4 opacity-20" />
              <p>暂无相关分享记录</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
