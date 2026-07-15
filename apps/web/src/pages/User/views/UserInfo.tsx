import { useMemo, useState } from 'react';
import {
  Building2,
  Camera,
  Mail,
  Phone,
  Save,
  Shield,
  User,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { message } from '@/components/ui/message';

type Profile = {
  displayName: string;
  username: string;
  email: string;
  phone: string;
  organization: string;
  role: string;
};

export default function UserInfo() {
  const initialProfile = useMemo<Profile>(
    () => ({
      displayName: 'openGMS 用户',
      username: 'openGMS...',
      email: 'user@opengms.com',
      phone: '138****0000',
      organization: '联合推演中心',
      role: '项目管理员'
    }),
    []
  );

  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [draft, setDraft] = useState<Profile>(initialProfile);
  const [isEditing, setIsEditing] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const startEdit = () => {
    setDraft(profile);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setDraft(profile);
    setNewPassword('');
    setConfirmPassword('');
    setIsEditing(false);
  };

  const saveProfile = () => {
    if (newPassword || confirmPassword) {
      if (newPassword.length < 6) {
        message.error('新密码至少 6 位');
        return;
      }
      if (newPassword !== confirmPassword) {
        message.error('两次输入的密码不一致');
        return;
      }
    }

    setProfile(draft);
    setNewPassword('');
    setConfirmPassword('');
    setIsEditing(false);
    message.success('用户信息已更新');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 text-foreground">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500">
            用户信息
          </h1>
          <p className="text-muted-foreground text-sm mt-1">查看与维护个人资料、账号安全</p>
        </div>
        {isEditing ? (
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={cancelEdit}>
              <X className="w-4 h-4" />
              取消
            </Button>
            <Button type="button" onClick={saveProfile}>
              <Save className="w-4 h-4" />
              保存
            </Button>
          </div>
        ) : (
          <Button type="button" onClick={startEdit}>
            编辑资料
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="bg-card border-border lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-foreground">账号概览</CardTitle>
            <CardDescription className="text-muted-foreground">
              头像、用户名与所属信息
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full border border-border bg-muted flex items-center justify-center overflow-hidden">
                <User className="w-7 h-7 text-foreground" />
              </div>
              <div className="min-w-0">
                <div className="text-base font-semibold truncate">
                  {profile.displayName}
                </div>
                <div className="text-sm text-muted-foreground truncate">
                  @{profile.username}
                </div>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full bg-transparent border-border text-foreground hover:bg-accent"
              disabled={!isEditing}
              onClick={() => message.info('已预留头像上传入口')}
            >
              <Camera className="w-4 h-4" />
              修改头像
            </Button>

            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="w-4 h-4 text-cyan-600 dark:text-cyan-300" />
                <span className="truncate">{profile.email}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Phone className="w-4 h-4 text-cyan-600 dark:text-cyan-300" />
                <span className="truncate">{profile.phone}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Building2 className="w-4 h-4 text-cyan-600 dark:text-cyan-300" />
                <span className="truncate">{profile.organization}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground">基础资料</CardTitle>
              <CardDescription className="text-muted-foreground">
                常用联系信息与展示名
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground" htmlFor="displayName">
                  显示名称
                </Label>
                <Input
                  id="displayName"
                  value={isEditing ? draft.displayName : profile.displayName}
                  disabled={!isEditing}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, displayName: e.target.value }))
                  }
                  className="bg-background border-border text-foreground disabled:opacity-80"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground" htmlFor="username">
                  用户名
                </Label>
                <Input
                  id="username"
                  value={isEditing ? draft.username : profile.username}
                  disabled
                  className="bg-background border-border text-foreground disabled:opacity-80"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground" htmlFor="email">
                  邮箱
                </Label>
                <Input
                  id="email"
                  value={isEditing ? draft.email : profile.email}
                  disabled={!isEditing}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, email: e.target.value }))
                  }
                  className="bg-background border-border text-foreground disabled:opacity-80"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground" htmlFor="phone">
                  手机
                </Label>
                <Input
                  id="phone"
                  value={isEditing ? draft.phone : profile.phone}
                  disabled={!isEditing}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, phone: e.target.value }))
                  }
                  className="bg-background border-border text-foreground disabled:opacity-80"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground" htmlFor="organization">
                  单位/组织
                </Label>
                <Input
                  id="organization"
                  value={isEditing ? draft.organization : profile.organization}
                  disabled={!isEditing}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, organization: e.target.value }))
                  }
                  className="bg-background border-border text-foreground disabled:opacity-80"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground" htmlFor="role">
                  角色
                </Label>
                <Input
                  id="role"
                  value={isEditing ? draft.role : profile.role}
                  disabled={!isEditing}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, role: e.target.value }))
                  }
                  className="bg-background border-border text-foreground disabled:opacity-80"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground">账号安全</CardTitle>
              <CardDescription className="text-muted-foreground">
                修改密码与退出登录
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground" htmlFor="newPassword">
                  新密码
                </Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  disabled={!isEditing}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="bg-background border-border text-foreground disabled:opacity-80"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground" htmlFor="confirmPassword">
                  确认新密码
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  disabled={!isEditing}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="bg-background border-border text-foreground disabled:opacity-80"
                />
              </div>
            </CardContent>
            <CardFooter className="justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Shield className="w-4 h-4 text-cyan-600 dark:text-cyan-300" />
                建议定期更新密码并开启安全策略
              </div>
              <Button
                type="button"
                variant="outline"
                className="bg-transparent border-border text-foreground hover:bg-accent"
                onClick={() => message.info('请使用右上角头像菜单退出登录')}
              >
                退出登录
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
