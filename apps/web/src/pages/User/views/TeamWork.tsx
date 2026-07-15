import { UserPlus, Users, ArrowRight } from 'lucide-react';

export default function TeamWork() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">团队协作</h1>
        <p className="text-muted-foreground">
          管理您的团队，创建新项目或加入现有协作。
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="group relative overflow-hidden rounded-2xl bg-card border border-border/50 p-8 transition-all duration-300 hover:bg-muted cursor-pointer hover:border-green-500/50 hover:shadow-[0_0_40px_-10px_rgba(34,197,94,0.2)]">
          <div className="relative z-10 flex items-start gap-6">
            <div className="p-4 rounded-xl bg-green-500/10 text-green-500 group-hover:scale-110 transition-transform duration-300">
              <UserPlus className="w-8 h-8" />
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-foreground group-hover:text-green-400 transition-colors">
                  创建小组
                </h3>
                <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-green-500 group-hover:translate-x-1 transition-all" />
              </div>
              <p className="text-muted-foreground text-sm leading-relaxed group-hover:text-muted-foreground transition-colors">
                新建一个小组，邀请其他成员加入，开始全新的协作项目。
              </p>
            </div>
          </div>
          <div className="absolute -right-20 -top-20 w-60 h-60 bg-green-500/5 rounded-full blur-3xl group-hover:bg-green-500/10 transition-colors duration-500" />
        </div>

        <div className="group relative overflow-hidden rounded-2xl bg-card border border-border/50 p-8 transition-all duration-300 hover:bg-muted cursor-pointer hover:border-blue-500/50 hover:shadow-[0_0_40px_-10px_rgba(59,130,246,0.2)]">
          <div className="relative z-10 flex items-start gap-6">
            <div className="p-4 rounded-xl bg-blue-500/10 text-blue-500 group-hover:scale-110 transition-transform duration-300">
              <Users className="w-8 h-8" />
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-foreground group-hover:text-blue-400 transition-colors">
                  加入小组
                </h3>
                <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
              </div>
              <p className="text-muted-foreground text-sm leading-relaxed group-hover:text-muted-foreground transition-colors">
                加入他人创建的小组，粘贴邀请码或链接，立即参与协作。
              </p>
            </div>
          </div>
          <div className="absolute -right-20 -top-20 w-60 h-60 bg-blue-500/5 rounded-full blur-3xl group-hover:bg-blue-500/10 transition-colors duration-500" />
        </div>
      </div>

      <div className="pt-8">
        <h2 className="text-xl font-semibold text-foreground mb-6 flex items-center gap-2">
          <Users className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
          我的团队
        </h2>

        <div className="rounded-xl border border-dashed border-border bg-muted p-12 text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Users className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-muted-foreground font-medium mb-1">暂无团队</h3>
          <p className="text-muted-foreground text-sm">
            您还没有加入任何团队，点击上方按钮开始吧。
          </p>
        </div>
      </div>
    </div>
  );
}
