import { useState, useEffect } from 'react';
import { Play, Pause, RefreshCw, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface DeductionStep {
  id: string;
  time: string;
  description: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  details?: string;
}

const MOCK_STEPS: DeductionStep[] = [
  {
    id: '1',
    time: '00:00:00',
    description: '初始化推演环境',
    status: 'completed',
    details: '加载地形数据... 完成\n加载单位数据... 完成'
  },
  {
    id: '2',
    time: '00:00:05',
    description: '红方单位开始部署',
    status: 'completed',
    details: '部署位置: [34.56, 112.34]\n部署数量: 3个装甲排'
  },
  {
    id: '3',
    time: '00:00:15',
    description: '蓝方侦察机起飞',
    status: 'processing',
    details: '侦察目标区域: A区'
  },
  {
    id: '4',
    time: '00:00:30',
    description: '遭遇战预警',
    status: 'pending'
  }
];

export default function DeductionPage({ embedded = false }: { embedded?: boolean }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [steps, setSteps] = useState<DeductionStep[]>(MOCK_STEPS);
  const [progress, setProgress] = useState(45);

  return (
    <div className={cn("flex flex-col bg-background text-foreground", embedded ? "h-full w-full" : "h-screen w-screen")}>
      {!embedded && (
        <div className="flex-none px-6 py-4 border-b border-border flex items-center justify-between bg-card">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold">事件推演系统</h1>
            <div className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-500 text-xs font-medium border border-blue-500/20">
              运行中
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsPlaying(!isPlaying)}>
              {isPlaying ? <Pause className="w-4 h-4 mr-2" /> : <Play className="w-4 h-4 mr-2" />}
              {isPlaying ? '暂停' : '继续'}
            </Button>
            <Button variant="outline" size="sm">
              <RefreshCw className="w-4 h-4 mr-2" />
              重置
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Deduction Log */}
        <div className="w-1/3 min-w-[300px] border-r border-border bg-card/50 flex flex-col">
          <div className="p-4 border-b border-border">
            <h2 className="text-sm font-medium mb-2">推演日志</h2>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between mt-1 text-xs text-muted-foreground">
              <span>进度: {progress}%</span>
              <span>耗时: 00:00:23</span>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-4">
              {steps.map((step, index) => (
                <div key={step.id} className="relative pl-6 pb-4 border-l border-border last:pb-0">
                  <div className={cn(
                    "absolute left-[-5px] top-0 w-2.5 h-2.5 rounded-full border-2",
                    step.status === 'completed' ? "bg-green-500 border-green-500" :
                    step.status === 'processing' ? "bg-blue-500 border-blue-500 animate-pulse" :
                    step.status === 'failed' ? "bg-red-500 border-red-500" :
                    "bg-background border-muted-foreground"
                  )} />

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{step.description}</span>
                      <span className="text-xs text-muted-foreground font-mono">{step.time}</span>
                    </div>

                    {step.details && (
                      <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded mt-1">
                        <pre className="whitespace-pre-wrap font-sans">{step.details}</pre>
                      </div>
                    )}

                    <div className="flex items-center gap-1 mt-1">
                      {step.status === 'completed' && <CheckCircle2 className="w-3 h-3 text-green-500" />}
                      {step.status === 'processing' && <Clock className="w-3 h-3 text-blue-500" />}
                      {step.status === 'failed' && <AlertCircle className="w-3 h-3 text-red-500" />}
                      <span className={cn(
                        "text-[10px] uppercase font-medium",
                        step.status === 'completed' ? "text-green-500" :
                        step.status === 'processing' ? "text-blue-500" :
                        step.status === 'failed' ? "text-red-500" :
                        "text-muted-foreground"
                      )}>
                        {step.status === 'completed' ? '已完成' :
                         step.status === 'processing' ? '进行中' :
                         step.status === 'failed' ? '失败' : '等待中'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Right Panel: Visualization Placeholder */}
        <div className="flex-1 bg-muted/30 flex items-center justify-center relative">
          <div className="text-center">
            <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
              <Play className="w-8 h-8 text-blue-500" />
            </div>
            <h3 className="text-lg font-medium text-foreground">推演可视化视图</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
              此处将显示实时的推演地图和单位动态。
              <br />
              (当前为演示模式)
            </p>
          </div>

          {/* Mock Overlay UI */}
          <div className="absolute top-4 right-4 bg-background/80 backdrop-blur border border-border p-3 rounded-lg shadow-lg">
            <div className="text-xs font-mono space-y-1">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">红方战损:</span>
                <span className="text-red-500">2%</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">蓝方战损:</span>
                <span className="text-blue-500">0%</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">仿真速率:</span>
                <span>1.0x</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
