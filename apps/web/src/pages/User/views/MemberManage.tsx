import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

interface Member {
  id: string;
  name: string;
  role: 'creator' | 'admin' | 'collaborator' | 'member';
  avatar?: string;
}

const ROLE_MAP = {
  creator: { label: '创建人', color: 'text-cyan-600', hasArrow: false },
  admin: { label: '管理员', color: 'text-gray-600', hasArrow: true },
  collaborator: { label: '协作者', color: 'text-gray-600', hasArrow: true },
  member: { label: '组员', color: 'text-gray-600', hasArrow: true }
};

const MOCK_MEMBERS: Member[] = [
  {
    id: '1',
    name: '张晓明',
    role: 'creator',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix'
  },
  {
    id: '2',
    name: '李思源',
    role: 'admin',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka'
  },
  {
    id: '3',
    name: '王梦琪',
    role: 'collaborator',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Mimi'
  },
  {
    id: '4',
    name: '陈子豪',
    role: 'member',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Jack'
  },
  {
    id: '5',
    name: '赵婉如',
    role: 'member',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Luna'
  }
];

export default function MemberManage() {
  const [showPermissions, setShowPermissions] = useState(true);

  return (
    <div className="min-h-full bg-[#f8fafc] text-gray-900 p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-gray-800">
          成员管理
        </h1>
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="bg-white text-gray-600 hover:bg-gray-50 border-gray-200 px-6 rounded-lg text-sm transition-all shadow-sm"
          >
            解散小组
          </Button>
          <Button className="bg-cyan-500 hover:bg-cyan-600 text-white border-none px-6 rounded-lg text-sm font-medium shadow-md shadow-cyan-500/20 transition-all">
            邀请成员
          </Button>
        </div>
      </div>

      {/* Permissions Section */}
      <div className="mb-10 bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
        <button
          onClick={() => setShowPermissions(!showPermissions)}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-cyan-600 transition-colors mb-4 group"
        >
          {showPermissions ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          <span className="font-semibold tracking-wide">角色权限说明</span>
        </button>

        {showPermissions && (
          <div className="space-y-4 pl-6 border-l-2 border-cyan-100 py-1">
            <div className="text-xs text-gray-500 leading-relaxed">
              <span className="text-gray-700 font-bold mr-2">组员:</span>
              使用小组空间的文件，修改自己在小组中的昵称
            </div>
            <div className="text-xs text-gray-500 leading-relaxed">
              <span className="text-gray-700 font-bold mr-2">协作者:</span>
              拥有组员所有权限外，可以上传文件，并对自己上传的内容进行管理
            </div>
            <div className="text-xs text-gray-500 leading-relaxed">
              <span className="text-gray-700 font-bold mr-2">管理员:</span>
              拥有协作者所有权限外，可以邀请新成员加入，控制成员权限，管理所有文件
            </div>
            <div className="text-xs text-gray-500 leading-relaxed">
              <span className="text-gray-700 font-bold mr-2">创建人:</span>
              拥有所有权限，若成员退出后，所有在小组内文件归属创建人
            </div>
          </div>
        )}
      </div>

      {/* Members List */}
      <div className="max-w-5xl bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {/* List Header */}
        <div className="grid grid-cols-[1fr_1fr] px-8 py-4 bg-gray-50/50 border-b border-gray-100 text-[11px] font-bold text-gray-400 uppercase tracking-widest">
          <div>昵称</div>
          <div>角色</div>
        </div>

        {/* List Rows */}
        <div className="divide-y divide-gray-50">
          {MOCK_MEMBERS.map((member) => (
            <div
              key={member.id}
              className="grid grid-cols-[1fr_1fr] items-center px-8 py-5 hover:bg-gray-50/80 transition-all group"
            >
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-full overflow-hidden border-2 border-white shadow-sm ring-1 ring-gray-100">
                  <img
                    src={member.avatar}
                    alt={member.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <span className="text-[15px] font-semibold text-gray-700 group-hover:text-cyan-600 transition-colors">
                  {member.name}
                </span>
              </div>

              <div className="flex items-center">
                <button
                  className={cn(
                    'flex items-center gap-2 text-xs font-bold transition-all px-3 py-1.5 rounded-full',
                    member.role === 'creator'
                      ? 'bg-cyan-50 text-cyan-600'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  )}
                >
                  {ROLE_MAP[member.role].label}
                  {ROLE_MAP[member.role].hasArrow && (
                    <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
