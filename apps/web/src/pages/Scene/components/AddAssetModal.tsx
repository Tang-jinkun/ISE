import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

interface Track {
  id: string;
  label: string;
  type?: string;
}

interface AddAssetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetItem: any;
  tracks: Track[];
  onConfirm: (trackId: string, startTime: number, duration: number) => void;
}

export function AddAssetModal({
  open,
  onOpenChange,
  assetItem,
  tracks,
  onConfirm
}: AddAssetModalProps) {
  const [step, setStep] = useState(1);
  const [selectedTrackId, setSelectedTrackId] = useState<string>('');
  const [startTime, setStartTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(1000);

  // 使用 mock 数据展示轨道列表
  const mockTracks: Track[] = [
    { id: 'track-2', label: '第2轨道', type: 'image' },
    { id: 'track-8', label: '第8轨道', type: 'image' }
  ];

  const displayTracks =
    tracks.length > 0
      ? tracks.filter((t) => {
          const type = t.type?.toLowerCase();
          return type === 'picture' || type === 'image';
        })
      : mockTracks;

  const filteredTracks = displayTracks;

  useEffect(() => {
    if (open) {
      setStep(1);
      setSelectedTrackId('');
      setStartTime(0);
      setDuration(1000);
    }
  }, [open]);

  const handleConfirm = () => {
    onConfirm(selectedTrackId, startTime, duration);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-none text-gray-900 sm:max-w-[500px] p-0 overflow-hidden rounded-lg shadow-2xl">
        <DialogHeader className="p-6 pb-2 border-b border-gray-100">
          <DialogTitle className="text-lg font-semibold text-gray-800">
            请选择素材要加入哪一条轨道？
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 py-6">
          {/* Steps Indicator */}
          <div className="flex items-center gap-4 mb-10">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors',
                  step === 1
                    ? 'bg-[#00bcd4] text-white'
                    : 'bg-gray-100 text-gray-400'
                )}
              >
                1
              </div>
              <div className="flex flex-col">
                <span
                  className={cn(
                    'text-sm font-medium',
                    step === 1 ? 'text-[#00bcd4]' : 'text-gray-400'
                  )}
                >
                  第一步
                </span>
                <span className="text-[11px] text-gray-400 leading-none mt-0.5">
                  请选择要加入的轨道
                </span>
              </div>
            </div>

            <div
              className={cn(
                'h-[2px] flex-1 mx-2 mt-[-10px] transition-colors',
                step === 2 ? 'bg-[#00bcd4]' : 'bg-gray-100'
              )}
            />

            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors',
                  step === 2
                    ? 'bg-[#00bcd4] text-white'
                    : 'bg-gray-100 text-gray-400'
                )}
              >
                2
              </div>
              <div className="flex flex-col">
                <span
                  className={cn(
                    'text-sm font-medium',
                    step === 2 ? 'text-[#00bcd4]' : 'text-gray-400'
                  )}
                >
                  第二步
                </span>
                <span className="text-[11px] text-gray-400 leading-none mt-0.5">
                  请输入素材的起始时间
                </span>
              </div>
            </div>
          </div>

          {step === 1 ? (
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {filteredTracks.length > 0 ? (
                filteredTracks.map((track, index) => (
                  <button
                    key={track.id}
                    onClick={() => {
                      setSelectedTrackId(track.id);
                      setStep(2);
                    }}
                    className={cn(
                      'w-full py-4 px-4 rounded-lg bg-[#00bcd4] hover:bg-[#00acc1] text-white text-center text-base font-medium transition-all relative group overflow-hidden shadow-md hover:shadow-lg',
                      'active:scale-[0.98]'
                    )}
                  >
                    {track.label || 'image 轨道'}
                  </button>
                ))
              ) : (
                <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                  未找到匹配类型的轨道，请先添加轨道。
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
              {/* Visual Timeline - Light Style */}
              <div className="w-full h-14 bg-gray-50 border border-gray-200 rounded-lg relative overflow-hidden flex items-center shadow-inner">
                <div
                  className="absolute h-full bg-red-500/80 border-x-2 border-red-600 z-10"
                  style={{
                    left: `${(startTime / 10000) * 100}%`,
                    width: `${(duration / 10000) * 100}%`
                  }}
                />
                {/* Thin vertical lines for segments */}
                <div className="absolute inset-0 flex justify-between px-0.5 opacity-10">
                  {[...Array(13)].map((_, i) => (
                    <div key={i} className="w-[1px] h-full bg-gray-900" />
                  ))}
                </div>
              </div>

              <div className="space-y-6 px-2">
                <div className="flex items-center justify-center gap-6">
                  <Label className="text-sm font-semibold text-gray-600 min-w-[80px] text-right">
                    起始时间
                  </Label>
                  <div className="flex-1 max-w-[220px]">
                    <div className="relative">
                      <Input
                        type="text"
                        value={`${startTime}ms`}
                        onChange={(e) => {
                          const val =
                            parseInt(e.target.value.replace('ms', '')) || 0;
                          setStartTime(val);
                        }}
                        className="bg-white border-gray-200 border-2 text-gray-800 focus:border-[#00bcd4] focus:ring-0 h-11 text-center font-bold rounded-lg transition-colors"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-center gap-6">
                  <Label className="text-sm font-semibold text-gray-600 min-w-[80px] text-right">
                    终止时间
                  </Label>
                  <div className="flex-1 max-w-[220px]">
                    <div className="relative">
                      <Input
                        type="text"
                        value={`${startTime + duration}ms`}
                        onChange={(e) => {
                          const val =
                            parseInt(e.target.value.replace('ms', '')) || 0;
                          setDuration(Math.max(100, val - startTime));
                        }}
                        className="bg-white border-gray-200 border-2 text-gray-800 focus:border-[#00bcd4] focus:ring-0 h-11 text-center font-bold rounded-lg transition-colors"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-center gap-5 pt-2">
                <Button
                  onClick={handleConfirm}
                  className="bg-[#00bcd4] hover:bg-[#00acc1] text-white px-16 h-12 text-lg font-bold rounded-lg shadow-lg hover:shadow-xl transition-all"
                >
                  确认添加
                </Button>
                <button
                  onClick={() => setStep(1)}
                  className="text-sm font-medium text-gray-400 hover:text-[#00bcd4] transition-colors flex items-center gap-1"
                >
                  <span className="text-xs">←</span> 返回上一步
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
