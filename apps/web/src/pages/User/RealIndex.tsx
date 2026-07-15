import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown';
import { cn } from '@/lib/utils';
import { useUserStore } from '@/stores/userStore';
import {
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  Cloud,
  Home,
  LayoutDashboard,
  Settings,
  Share2,
  Sparkles,
  UserCircle,
  Users
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams
} from 'react-router-dom';

export default function UserLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const user = useUserStore((s) => s.user);
  const fetchUser = useUserStore((s) => s.fetchUser);
  const logout = useUserStore((s) => s.logout);

  useEffect(() => {
    if (!user) {
      fetchUser();
    }
  }, [user, fetchUser]);

  const groups = useMemo(
    () => [
      { id: 'g-1', name: '联合推演小组 A' },
      { id: 'g-2', name: '战例分析小组 B' },
      { id: 'g-3', name: '训练素材共建小组 C' }
    ],
    []
  );

  const groupId = searchParams.get('groupId');
  const activeGroup = useMemo(
    () => groups.find((g) => g.id === groupId) ?? null,
    [groupId, groups]
  );
  const inGroupMode = Boolean(activeGroup);

  const navItems = useMemo(() => {
    if (inGroupMode) {
      return [
        {
          name: '小组主页',
          path: `groupinfo?groupId=${activeGroup!.id}`,
          activePath: 'groupinfo',
          icon: Home
        },
        {
          name: '小组公共空间',
          path: `membermanage?groupId=${activeGroup!.id}`,
          activePath: 'membermanage',
          icon: Cloud
        }
      ];
    }

    return [
      { name: '主页', path: 'homepage', activePath: 'homepage', icon: Home },
      { name: '我的空间', path: 'myroom', activePath: 'myroom', icon: Cloud },
      {
        name: '团队协作',
        path: 'teamwork',
        activePath: 'teamwork',
        icon: Users
      },
      {
        name: '分享管理',
        path: 'sharemanage',
        activePath: 'sharemanage',
        icon: Share2
      },
      {
        name: 'AI生成',
        path: 'generativeai',
        activePath: 'generativeai',
        icon: Sparkles,
        hot: true
      },
      {
        name: '管理界面',
        path: 'managepage',
        activePath: 'managepage',
        icon: LayoutDashboard
      },
      {
        name: '战例史料知识库',
        path: 'knowledgebase',
        activePath: 'knowledgebase',
        icon: BookOpen
      }
    ];
  }, [activeGroup, inGroupMode]);

  const switchToGroup = (id: string) => {
    navigate(`groupinfo?groupId=${id}`);
  };

  const switchToPersonal = () => {
    navigate('homepage');
  };

  const headerTitle = inGroupMode
    ? activeGroup!.name
    : user?.displayName || user?.username || '用户中心';
  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground flex flex-col font-sans">
      <div className="border-b border-border bg-background/80 backdrop-blur px-6 py-4 flex items-center justify-between gap-4">
        <div className="text-lg font-semibold">智能化战例场景编排器</div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Button variant="ghost" size="icon">
            <Bell className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon">
            <Settings className="w-5 h-5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border"
              >
                {avatarFailed ? (
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <UserCircle className="w-5 h-5" />
                  </div>
                ) : (
                  <img
                    src={user?.avatarUrl || 'https://github.com/shadcn.png'}
                    alt={user?.displayName || user?.username || 'User'}
                    className="aspect-square h-full w-full"
                    onError={() => setAvatarFailed(true)}
                  />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => navigate('/user/userinfo')}>
                用户信息
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={handleLogout}
                className="text-red-500 focus:text-red-500"
              >
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 border-r border-border flex flex-col p-4 gap-6 bg-card">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="bg-card border border-border rounded-xl p-4 flex items-center gap-3 hover:bg-accent transition-colors cursor-pointer group w-full text-left"
              >
                <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center shrink-0 overflow-hidden">
                  {avatarFailed ? (
                    <UserCircle className="w-6 h-6 text-white/90" />
                  ) : (
                    <img
                      src="https://github.com/shadcn.png"
                      alt="User"
                      className="w-full h-full object-cover"
                      onError={() => setAvatarFailed(true)}
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">
                    {inGroupMode
                      ? activeGroup!.name
                      : user?.displayName || user?.username || '未登录用户'}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {inGroupMode ? '小组空间' : user?.email || '个人版'}
                  </div>
                </div>
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuSeparator />
              {groups.map((g) => (
                <DropdownMenuItem
                  key={g.id}
                  onSelect={() => switchToGroup(g.id)}
                  className="gap-2"
                >
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{g.name}</span>
                  {activeGroup?.id === g.id && (
                    <Check className="w-4 h-4 text-cyan-600 dark:text-cyan-300" />
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={switchToPersonal} className="gap-2">
                <UserCircle className="w-4 h-4 text-muted-foreground" />
                加入小组
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={switchToPersonal} className="gap-2">
                <UserCircle className="w-4 h-4 text-muted-foreground" />
                创建小组
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <nav className="space-y-1 flex-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const activePath = item.activePath;
              const itemActive = location.pathname.includes(
                `/user/${activePath}`
              );

              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 group relative',
                    itemActive
                      ? 'text-foreground bg-accent'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  )}
                >
                  <Icon
                    className={cn(
                      'w-5 h-5',
                      itemActive
                        ? 'text-cyan-500'
                        : 'text-muted-foreground group-hover:text-foreground'
                    )}
                  />
                  <span>{item.name}</span>
                  {item.hot && (
                    <span className="ml-auto bg-red-600 text-primary-foreground text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                      HOT
                    </span>
                  )}
                  {itemActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-cyan-400 rounded-r-full" />
                  )}
                </NavLink>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 overflow-auto bg-background p-8 relative">
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
