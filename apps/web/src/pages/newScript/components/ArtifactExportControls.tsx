import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  return (
    <div className="flex items-center gap-1">
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
              if (payload !== undefined) download(filename, payload);
            }}
          >
            <Download className="h-3.5 w-3.5" />
            {label}
          </Button>
        );
      })}
    </div>
  );
}
