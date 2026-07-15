import { tokenStorage } from '@/api/http';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { useUserStore } from '@/stores/userStore';
import { LayoutDashboard, LogOut, User } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Avatar,
  AvatarFallback,
  AvatarImage
} from '../../components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../../components/ui/dropdown';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

export default function Header() {
  const user = useUserStore((s) => s.user);
  const fetchUser = useUserStore((s) => s.fetchUser);
  const logout = useUserStore((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === '/';

  useEffect(() => {
    const token = tokenStorage.getToken(tokenStorage.keys.access);
    if (token && !user) {
      fetchUser();
    }
  }, [user, fetchUser]);

  const navItems = [
    { name: '首页', path: '/' },
    { name: '个人中心', path: '/user' },
    { name: '场景示例', path: '/examples' },
    { name: '帮助文档', path: '/docs/help' }
  ];

  return (
    <header
      className={cn(
        'fixed top-0 left-0 w-full z-50 flex items-center justify-between px-6 py-4 backdrop-blur-md border-b transition-colors duration-300',
        'bg-background/80 border-border'
      )}
    >
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-primary/20 rounded-lg flex items-center justify-center">
          {/* Placeholder for Logo */}
          <span className="text-2xl">🌍</span>
        </div>
        <h1 className="text-xl font-bold tracking-tight">
          智能化战例场景生成器
        </h1>
        <nav className="hidden md:flex items-center gap-8">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'text-sm font-medium transition-colors hover:text-primary',
                location.pathname === item.path
                  ? 'text-primary font-bold'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {item.name}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-4">
        <ThemeToggle />
        {!user ? (
          <>
            <Button variant="default">立即创作</Button>
            <Button variant="outline" onClick={() => navigate('/login')}>
              登录/注册
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost">工作台</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="relative h-10 w-10 rounded-full p-0"
                >
                  <Avatar className="h-10 w-10">
                    <AvatarImage src="" alt="User" />
                    <AvatarFallback>U</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem>
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  <span>工作台</span>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <User className="mr-2 h-4 w-4" />
                  <span>个人信息</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    logout();
                    navigate('/login');
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>退出登录</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </header>
  );
}
