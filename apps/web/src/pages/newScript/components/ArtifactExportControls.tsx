import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown';
import { message } from '@/components/ui/message';
import {
  type ArtifactExports,
  downloadJson
} from '../artifactExports';

type ArtifactExportControlsProps = {
  exports: ArtifactExports;
  download?: (filename: string, payload: unknown) => void;
};

const commands = [
  ['EventPlan', 'event-plan.json', 'eventPlan'],
  ['RuntimePlan', 'canonical-runtime-plan.json', 'runtimePlan'],
  ['SceneProject', 'scene-project.json', 'sceneProject']
] as const;

export function ArtifactExportControls({
  exports,
  download = downloadJson
}: ArtifactExportControlsProps) {
  const handleDownload = (filename: string, payload: unknown) => {
    try {
      download(filename, payload);
    } catch {
      message.error('下载失败，请稍后重试');
    }
  };

  return (
    <>
      <div
        data-testid="artifact-export-wide"
        className="hidden items-center gap-1 lg:flex"
      >
        {commands.map(([label, filename, key]) => {
          const payload = exports[key];
          return (
            <Button
              key={key}
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 px-2"
              disabled={payload === undefined}
              onClick={() => {
                if (payload !== undefined) handleDownload(filename, payload);
              }}
            >
              <Download className="h-3.5 w-3.5" />
              {label}
            </Button>
          );
        })}
      </div>
      <div data-testid="artifact-export-compact" className="lg:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label="Export artifacts"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {commands.map(([label, filename, key]) => {
              const payload = exports[key];
              return (
                <DropdownMenuItem
                  key={key}
                  disabled={payload === undefined}
                  onSelect={() => {
                    if (payload !== undefined) handleDownload(filename, payload);
                  }}
                >
                  <Download className="mr-2 h-3.5 w-3.5" />
                  {label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
