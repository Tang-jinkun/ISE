import { useState } from 'react';
import {
  FileText,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { message } from '@/components/ui/message';
import { uploadFile } from '@/api/file';

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  folderId?: string | null;
}

export function UploadDialog({
  open,
  onOpenChange,
  onSuccess,
  folderId,
}: UploadDialogProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadFileObj, setUploadFileObj] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadType, setUploadType] = useState<'image' | 'video' | 'file' | 'audio'>('file');

  const getFileType = (file: File) => {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    return 'file';
  };

  const bytesToSize = (size?: number) => {
    if (!size || size <= 0) return '-';
    const i = Math.floor(Math.log(size) / Math.log(1024));
    const num = (size / Math.pow(1024, i)).toFixed(1);
    const unit = ['B', 'KB', 'MB', 'GB', 'TB'][i] || 'B';
    return `${num} ${unit}`;
  };

  const handleFileSelect = (file: File | null) => {
    setUploadFileObj(file);
    if (file) {
      setUploadType(getFileType(file));
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setPreviewUrl(reader.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        setPreviewUrl(null);
      }
    } else {
      setPreviewUrl(null);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    onOpenChange(newOpen);
    if (!newOpen) {
      // Reset state when closing
      setUploadFileObj(null);
      setPreviewUrl(null);
      setUploadProgress(0);
      setUploading(false);
    }
  };

  const handleUpload = async () => {
    if (!uploadFileObj) return;
    try {
      setUploading(true);
      setUploadProgress(0);
      await uploadFile(
        uploadFileObj,
        {
          fileType: uploadType,
          folderId: folderId || undefined
        },
        (p) => setUploadProgress(p)
      );
      message.success('上传成功');
      handleOpenChange(false);
      onSuccess?.();
    } catch {
      message.error('上传失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-background border-border text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>上传文件</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="flex flex-col items-center justify-center">
            {!uploadFileObj ? (
              <label className="w-full aspect-video border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-cyan-500/50 hover:bg-primary/5 transition-all group">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4 group-hover:bg-cyan-500/20 transition-colors">
                  <Plus className="w-8 h-8 text-muted-foreground group-hover:text-cyan-400 transition-colors" />
                </div>
                <span className="text-sm text-muted-foreground group-hover:text-muted-foreground">
                  点击选择文件
                </span>
                <Input
                  type="file"
                  className="hidden"
                  onChange={(e) =>
                    handleFileSelect(e.target.files?.[0] ?? null)
                  }
                />
              </label>
            ) : (
              <div className="w-full relative group">
                {previewUrl ? (
                  <div className="w-full aspect-video rounded-xl overflow-hidden border border-border bg-muted/20">
                    <img
                      src={previewUrl}
                      alt="Preview"
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="w-full aspect-video rounded-xl border border-border bg-muted flex flex-col items-center justify-center">
                    <FileText className="w-16 h-16 text-muted-foreground mb-2" />
                    <span className="text-sm text-muted-foreground">
                      {uploadFileObj.name}
                    </span>
                    <span className="text-xs text-muted-foreground/80 mt-1">
                      {bytesToSize(uploadFileObj.size)}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => handleFileSelect(null)}
                  className="absolute top-2 right-2 p-1 rounded-full bg-background/80 hover:bg-red-500/80 text-foreground opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              disabled={uploading || !uploadFileObj}
              onClick={handleUpload}
              className="bg-cyan-600 hover:bg-cyan-700"
            >
              {uploading ? `${uploadProgress}%` : '确定上传'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
