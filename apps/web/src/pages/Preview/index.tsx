import { getScene } from '@/api/scene';
import { useSceneRuntime } from '@/hooks/useSceneRuntime';
import {
  sceneProjectConfigSchema,
  type SceneProjectConfig,
} from '@ise/runtime-contracts';
import type mapboxgl from 'mapbox-gl';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SceneCanvas } from '../Scene/components/SceneCanvas';
import { SceneHeader } from '../Scene/components/SceneHeader';

function validationMessage(error: { issues: readonly { message: string }[] }) {
  return error.issues.map((issue) => issue.message).join('; ');
}

export default function Preview() {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');
  const [title, setTitle] = useState('未命名场景');
  const [config, setConfig] = useState<SceneProjectConfig | null>(null);
  const [blockingError, setBlockingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [runtimeTarget, setRuntimeTarget] = useState<{
    map: mapboxgl.Map;
    overlayRoot: HTMLElement;
  } | null>(null);

  useEffect(() => {
    let active = true;
    if (!projectId) {
      setBlockingError('缺少场景 ID。');
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setBlockingError(null);
    void getScene(projectId)
      .then((response) => {
        if (!active) return;
        const parsed = sceneProjectConfigSchema.safeParse(response.data.config);
        if (!parsed.success) {
          setConfig(null);
          setBlockingError(validationMessage(parsed.error));
          return;
        }
        setTitle(response.data.title);
        setConfig(parsed.data);
      })
      .catch(() => {
        if (active) setBlockingError('场景加载失败。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [projectId]);

  const handleMapReady = useCallback(
    (map: mapboxgl.Map, overlayRoot: HTMLElement) => {
      setRuntimeTarget({ map, overlayRoot });
    },
    [],
  );
  const handleMapDispose = useCallback((map: mapboxgl.Map) => {
    setRuntimeTarget((target) => (target?.map === map ? null : target));
  }, []);

  const runtime = useSceneRuntime({
    map: runtimeTarget?.map ?? null,
    overlayRoot: runtimeTarget?.overlayRoot ?? null,
    config,
  });

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-sm text-muted-foreground">
        正在加载场景...
      </div>
    );
  }

  if (blockingError || !config) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background px-6 text-foreground">
        <div
          role="alert"
          className="max-w-xl border-l-2 border-red-500 px-4 py-3 text-sm text-red-400"
        >
          {blockingError || '场景配置无效。'}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-screen flex-col bg-background"
      data-testid="scene-runtime-ready"
      data-status={runtime.status}
    >
      <SceneHeader
        projectTitle={title}
        totalDuration={config.totalDurationMs / 1000}
        currentTime={runtime.currentTimeMs / 1000}
        onPlay={() => void runtime.play().catch(() => undefined)}
        onPause={runtime.pause}
        onReplay={() => void runtime.replay().catch(() => undefined)}
        runtimeReady={runtime.status === 'ready'}
        mode="preview"
      />
      <SceneCanvas
        mode="preview"
        onMapReady={handleMapReady}
        onMapDispose={handleMapDispose}
      />
    </div>
  );
}
