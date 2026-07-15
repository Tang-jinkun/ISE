import { getScene, updateScene } from '@/api/scene';
import { message } from '@/components/ui/message';
import { useSceneStore } from '@/stores/sceneStore';
import {
  sceneProjectConfigSchema,
  type SceneProjectConfig,
  type SceneTrack,
  type SceneTrackItem,
} from '@ise/runtime-contracts';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AssetLibrary } from './components/AssetLibrary';
import { PropertyPanel } from './components/PropertyPanel';
import { SceneCanvas } from './components/SceneCanvas';
import { SceneHeader } from './components/SceneHeader';
import { Timeline } from './components/Timeline';

function validationMessage(error: { issues: readonly { message: string }[] }) {
  return error.issues.map((issue) => issue.message).join('; ');
}

export default function Scene() {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');
  const currentScene = useSceneStore((state) => state.currentScene);
  const config = useSceneStore((state) => state.config);
  const selectedClip = useSceneStore((state) => state.selectedClip);
  const setCurrentScene = useSceneStore((state) => state.setCurrentScene);
  const updateCurrentScene = useSceneStore((state) => state.updateCurrentScene);
  const setConfig = useSceneStore((state) => state.setConfig);
  const updateTrackItem = useSceneStore((state) => state.updateTrackItem);
  const removeTrackItem = useSceneStore((state) => state.removeTrackItem);
  const setSelectedClip = useSceneStore((state) => state.setSelectedClip);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [blockingError, setBlockingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
          useSceneStore.setState({ config: null });
          setBlockingError(validationMessage(parsed.error));
          return;
        }
        setCurrentScene(response.data);
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
  }, [projectId, setConfig, setCurrentScene]);

  const projectTitle = currentScene?.title || '未命名的场景项目';
  const tracks = config?.tracks ?? [];
  const totalDurationMs = config?.totalDurationMs ?? 0;
  const selectedClipId = selectedClip?.id;

  const trackTypes = useMemo(
    () => new Map(tracks.map((track) => [track.trackId, track.type])),
    [tracks],
  );

  const handleSave = async () => {
    if (!currentScene?.id || !config) return;
    try {
      const validated = sceneProjectConfigSchema.parse(config);
      await updateScene(currentScene.id, {
        title: currentScene.title,
        type: currentScene.type,
        config: validated,
      });
      message.success('更新成功');
    } catch {
      message.error('更新失败');
    }
  };

  const updateConfig = (next: SceneProjectConfig) => {
    setConfig(sceneProjectConfigSchema.parse(next));
  };

  const handleToggleVisibility = (trackId: string) => {
    if (!config) return;
    updateConfig({
      ...config,
      tracks: config.tracks.map((track) =>
        track.trackId === trackId ? { ...track, visible: !track.visible } : track,
      ) as SceneTrack[],
    });
  };

  const handleDeleteTrack = (trackId: string) => {
    if (!config) return;
    updateConfig({
      ...config,
      tracks: config.tracks.filter((track) => track.trackId !== trackId),
    });
    if (selectedClip?.trackId === trackId) setSelectedClip(null);
  };

  const handleClipSelect = (
    item: SceneTrackItem,
    trackId: string,
    trackType: SceneTrack['type'],
  ) => {
    setSelectedClip({
      ...item,
      id: item.id,
      label: item.id,
      trackId,
      trackType,
      start: item.startMs,
      width: item.durationMs,
      startMs: item.startMs,
      durationMs: item.durationMs,
    });
  };

  const handleClipChange = (
    trackId: string,
    itemId: string,
    startMs: number,
    durationMs: number,
    targetTrackId?: string,
  ) => {
    if (targetTrackId && targetTrackId !== trackId) {
      const sourceType = trackTypes.get(trackId);
      const targetType = trackTypes.get(targetTrackId);
      if (sourceType !== targetType) return;
    }
    updateTrackItem(trackId, itemId, { startMs, durationMs });
    if (selectedClip?.id === itemId) {
      setSelectedClip({
        ...selectedClip,
        start: startMs,
        width: durationMs,
        startMs,
        durationMs,
      });
    }
  };

  const handleDeleteClip = (trackId: string, itemId: string) => {
    removeTrackItem(trackId, itemId);
    if (selectedClip?.id === itemId) setSelectedClip(null);
  };

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
        <div role="alert" className="max-w-xl border-l-2 border-red-500 px-4 py-3 text-sm text-red-400">
          {blockingError || '场景配置无效。'}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <SceneHeader
        projectTitle={projectTitle}
        totalDuration={totalDurationMs / 1000}
        currentTime={currentTimeMs / 1000}
        onTitleChange={(title) => updateCurrentScene({ title })}
        onSave={handleSave}
      />

      <div className="flex min-h-0 flex-1">
        <AssetLibrary
          tracks={tracks}
          onAddAsset={() => message.error('请先在资源目录中注册素材。')}
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <SceneCanvas />
            <PropertyPanel />
          </div>

          <Timeline
            tracks={tracks}
            selectedClipId={selectedClipId}
            currentTimeMs={currentTimeMs}
            totalDurationMs={totalDurationMs}
            onTimeChange={(timeMs) =>
              setCurrentTimeMs(Math.min(Math.max(0, timeMs), totalDurationMs))
            }
            onToggleVisibility={handleToggleVisibility}
            onDeleteTrack={handleDeleteTrack}
            onDeleteClip={handleDeleteClip}
            onClipSelect={handleClipSelect}
            onClipChange={handleClipChange}
          />
        </main>
      </div>
    </div>
  );
}
