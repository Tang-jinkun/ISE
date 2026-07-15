import { getScene, updateScene } from '@/api/scene';
import { message } from '@/components/ui/message';
import {
  audioItemDefault,
  cameraRotateItemDefault,
  geojsonItemDefault,
  imageRasterItemDefault,
  mapEaseItemDefault,
  pictureItemDefault,
  videoItemDefault
} from '@/config/sceneItemDefaults';
import { useSceneStore } from '@/stores/sceneStore';
import { useTaskSceneStore } from '@/stores/taskSceneStore';
import {
  Activity,
  FileText,
  Image as ImageIcon,
  MapPin,
  Video,
  Volume2
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AssetLibrary } from './components/AssetLibrary';
import { PropertyPanel } from './components/PropertyPanel';
import { SceneCanvas } from './components/SceneCanvas';
import { SceneHeader } from './components/SceneHeader';
import { Timeline, type Track } from './components/Timeline';

export default function Scene() {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');
  const { currentScene, setCurrentScene, updateCurrentScene } = useSceneStore();
  const setTaskSceneInfo = useTaskSceneStore((state) => state.setTaskSceneInfo);

  const projectTitle = currentScene?.title || '未命名的场景项目';

  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const setSelectedClip = useSceneStore((state) => state.setSelectedClip);
  const selectedClip = useSceneStore((state) => state.selectedClip);

  // Sync tracks to taskSceneStore
  useEffect(() => {
    const content = tracks.map((track) => {
      let pathType = track.type;
      if (track.type === 'vector') pathType = 'geojson';
      else if (track.type === 'camera_move') pathType = 'mapEase';
      else if (track.type === 'dynamic_line') pathType = 'dynamicLine';
      else if (track.type === 'image') pathType = 'picture';

      return {
        id: track.id,
        visual: track.visible !== false,
        path_type: pathType,
        element_array: track.clips.map((clip) => ({
          ...clip,
          id: clip.id,
          start: clip.start * 1000,
          finish: (clip.start + clip.width) * 1000,
          file_url: clip.content,
          url: clip.content
        }))
      };
    });

    setTaskSceneInfo({
      content,
      sceneAssociated: [],
      sceneAssociatedVisual: false
    });
  }, [tracks, setTaskSceneInfo]);

  // Sync currentTime to taskSceneStore and trigger preview
  useEffect(() => {
    // Get direct access to store to avoid subscription loops
    const store = useTaskSceneStore.getState();

    // Ideally we only trigger if not playing, but we don't track playing state here yet
    store.currentInterval = currentTime * 1000;

    // Only jump if we have content
    if (tracks.length > 0) {
    }
  }, [currentTime, tracks.length]);

  useEffect(() => {
    if (projectId) {
      getScene(projectId).then((res) => {
        if (res.data) {
          setCurrentScene(res.data);
        }
      });
    }
  }, [projectId, setCurrentScene]);

  const handleSave = async () => {
    if (!currentScene?.id) return;
    try {
      // Create a clean copy of tracks without React nodes (icons) for storage
      const tracksToSave = tracks.map((track) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { icon, ...rest } = track;
        return rest;
      });

      const updatedScene = {
        ...currentScene,
        config: JSON.stringify(tracksToSave)
      };

      await updateScene(currentScene.id, updatedScene);
      message.success('更新成功');
    } catch (e) {
      message.error('更新失败');
    }
  };

  // Sync selectedClip changes back to tracks
  useEffect(() => {
    if (!selectedClip) return;

    setTracks((prev) => {
      const trackIndex = prev.findIndex((t) => t.id === selectedClip.trackId);
      if (trackIndex === -1) return prev;

      const track = prev[trackIndex];
      const clipIndex = track.clips.findIndex((c) => c.id === selectedClip.id);
      if (clipIndex === -1) return prev;

      const clip = track.clips[clipIndex];

      // Simple equality check to avoid unnecessary updates if possible,
      // but since selectedClip is often a new object, we just update.
      // Ideally we should check if content actually changed.
      const newClip = { ...clip, ...selectedClip };

      const newTracks = [...prev];
      const newTrack = { ...track };
      newTrack.clips = [...track.clips];
      newTrack.clips[clipIndex] = newClip;
      newTracks[trackIndex] = newTrack;

      return newTracks;
    });
  }, [selectedClip]);

  const totalDuration = useMemo(() => {
    let maxTime = 0;
    tracks.forEach((track) => {
      if (track.visible === false) return;
      track.clips.forEach((clip) => {
        const end = clip.start + clip.width;
        if (end > maxTime) maxTime = end;
      });
    });
    return maxTime || 2000;
  }, [tracks]);

  useEffect(() => {
    if (!currentScene?.config) return;

    try {
      const configData =
        typeof currentScene.config === 'string'
          ? JSON.parse(currentScene.config)
          : currentScene.config;

      if (Array.isArray(configData)) {
        const loadedTracks = configData.map((track: any) => {
          // Reconstruct icon component based on type
          let icon = <Activity className="w-3 h-3 text-gray-400" />;
          if (track.type === 'vector')
            icon = <MapPin className="w-3 h-3 text-fuchsia-300" />;
          else if (track.type === 'camera_move')
            icon = <Video className="w-3 h-3 text-cyan-300" />;
          else if (track.type === 'image')
            icon = <ImageIcon className="w-3 h-3 text-blue-300" />;
          else if (track.type === 'video')
            icon = <Video className="w-3 h-3 text-purple-300" />;
          else if (track.type === 'text')
            icon = <FileText className="w-3 h-3 text-yellow-300" />;
          else if (track.type === 'audio')
            icon = <Volume2 className="w-3 h-3 text-emerald-300" />;
          else if (track.type === 'dynamic_line')
            icon = <Activity className="w-3 h-3 text-orange-300" />;

          return {
            ...track,
            icon
          };
        });
        setTracks(loadedTracks);
      }
    } catch (e) {
      console.error('Failed to parse scene config:', e);
    }
  }, [currentScene?.config]);

  const handleToggleVisibility = (id: string) => {
    setTracks((prev) =>
      prev.map((track) =>
        track.id === id ? { ...track, visible: track.visible === false } : track
      )
    );
  };

  const handleDeleteTrack = (id: string) => {
    setTracks((prev) => prev.filter((track) => track.id !== id));
  };

  const handleDeleteClip = (trackId: string, clipId: string) => {
    setTracks((prev) => {
      const newTracks = [...prev];
      const trackIndex = newTracks.findIndex((t) => t.id === trackId);
      if (trackIndex === -1) return prev;

      const track = { ...newTracks[trackIndex] };
      track.clips = track.clips.filter((c) => c.id !== clipId);
      newTracks[trackIndex] = track;

      return newTracks;
    });

    if (selectedClip?.id === clipId) {
      setSelectedClip(null);
    }
  };

  const handleClipSelect = (clip: any, trackId: string, trackType: string) => {
    setSelectedClip({
      ...clip,
      id: clip.id,
      label: clip.label,
      trackId,
      trackType,
      start: clip.start,
      width: clip.width,
      color: clip.color
    });
  };

  const handleClipChange = (
    sourceTrackId: string,
    clipId: string,
    newStart: number,
    newDuration: number,
    targetTrackId?: string
  ) => {
    setTracks((prev) => {
      const newTracks = [...prev];
      const sourceTrackIndex = newTracks.findIndex(
        (t) => t.id === sourceTrackId
      );
      if (sourceTrackIndex === -1) return prev;

      const sourceTrack = { ...newTracks[sourceTrackIndex] };
      const clipIndex = sourceTrack.clips.findIndex((c) => c.id === clipId);
      if (clipIndex === -1) return prev;

      const clip = { ...sourceTrack.clips[clipIndex] };

      // Update clip data
      clip.start = newStart;
      clip.width = newDuration;

      // Check if moving to another track
      if (targetTrackId && targetTrackId !== sourceTrackId) {
        const targetTrackIndex = newTracks.findIndex(
          (t) => t.id === targetTrackId
        );
        if (targetTrackIndex !== -1) {
          // Remove from source
          sourceTrack.clips = [...sourceTrack.clips];
          sourceTrack.clips.splice(clipIndex, 1);
          newTracks[sourceTrackIndex] = sourceTrack;

          // Add to target
          const targetTrack = { ...newTracks[targetTrackIndex] };
          targetTrack.clips = [...targetTrack.clips, clip];
          newTracks[targetTrackIndex] = targetTrack;

          // Update store if selected
          if (selectedClip?.id === clipId) {
            setSelectedClip({
              ...selectedClip,
              start: newStart,
              width: newDuration,
              trackId: targetTrackId
            });
          }
        }
      } else {
        // Same track update
        sourceTrack.clips = [...sourceTrack.clips];
        sourceTrack.clips[clipIndex] = clip;
        newTracks[sourceTrackIndex] = sourceTrack;

        // Update store if selected
        if (selectedClip?.id === clipId) {
          setSelectedClip({
            ...selectedClip,
            start: newStart,
            width: newDuration
          });
        }
      }

      return newTracks;
    });
  };

  const handleAssetDrop = (trackId: string, startTime: number, item: any) => {
    // Set current time to the drop time to preview the item immediately
    setCurrentTime(startTime);

    let defaultProps: any = {};
    let finalTrackType = item.type;

    if (item.type === 'image') {
      defaultProps = pictureItemDefault;
    } else if (item.type === 'video') {
      defaultProps = videoItemDefault;
    } else if (item.type === 'audio') {
      defaultProps = audioItemDefault;
    } else if (item.type === 'geojson') {
      defaultProps = geojsonItemDefault;
      finalTrackType = 'vector';
    } else if (item.type === 'raster') {
      defaultProps = imageRasterItemDefault;
    } else if (item.type === 'action') {
      if (item.id === 'action-rotate') {
        defaultProps = cameraRotateItemDefault;
        finalTrackType = 'camera_rotate';
      } else {
        defaultProps = mapEaseItemDefault;
        finalTrackType = 'camera_transition';
      }
    }

    const newClip = {
      ...defaultProps,
      id: crypto.randomUUID(),
      label: item.name,
      color: 'bg-blue-500/50 border-blue-500',
      start: startTime,
      width: 5,
      content: item.url,
      trackType: finalTrackType
    };

    if (item.type === 'video') {
      newClip.color = 'bg-purple-500/50 border-purple-500';
    } else if (item.type === 'audio') {
      newClip.color = 'bg-green-500/50 border-green-500';
    } else if (item.type === 'action') {
      newClip.color = 'bg-orange-500/50 border-orange-500';
      newClip.width = 2;
    }

    setTracks((prev) =>
      prev.map((track) => {
        if (track.id === trackId) {
          return {
            ...track,
            clips: [...track.clips, newClip]
          };
        }
        return track;
      })
    );
  };

  const handleAddTrack = (type: string) => {
    // Map internal type to display properties
    let label = '未知';
    let icon = <Activity className="w-3 h-3 text-gray-400" />;
    let color = 'bg-gray-500/50 border-gray-500';

    switch (type) {
      case 'vector':
        label = '矢量';
        icon = <MapPin className="w-3 h-3 text-fuchsia-300" />;
        color = 'bg-fuchsia-500/50 border-fuchsia-500';
        break;
      case 'camera_move':
        label = '镜头';
        icon = <Video className="w-3 h-3 text-cyan-300" />;
        color = 'bg-cyan-500/50 border-cyan-500';
        break;
      case 'image':
        label = '图片';
        icon = <ImageIcon className="w-3 h-3 text-blue-300" />;
        color = 'bg-blue-500/50 border-blue-500';
        break;
      case 'video':
        label = '视频';
        icon = <Video className="w-3 h-3 text-purple-300" />;
        color = 'bg-purple-500/50 border-purple-500';
        break;
      case 'text':
        label = '字幕';
        icon = <FileText className="w-3 h-3 text-yellow-300" />;
        color = 'bg-yellow-500/50 border-yellow-500';
        break;
      case 'audio':
        label = '音频';
        icon = <Volume2 className="w-3 h-3 text-emerald-300" />;
        color = 'bg-emerald-500/50 border-emerald-500';
        break;
      case 'dynamic_line':
        label = '连接';
        icon = <Activity className="w-3 h-3 text-orange-300" />;
        color = 'bg-orange-500/50 border-orange-500';
        break;
    }

    const newTrack = {
      id: crypto.randomUUID(),
      label,
      type,
      visual: true,
      visible: true,
      path_type: type,
      element_array: [],
      clips: [], // UI state
      icon // UI state
    };

    setTracks((prev) => [...prev, newTrack]);
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground flex flex-col">
      <SceneHeader
        projectTitle={projectTitle}
        totalDuration={totalDuration}
        currentTime={currentTime}
        onTitleChange={(title) => updateCurrentScene({ title })}
        onSave={handleSave}
      />

      <div className="flex flex-1 min-h-0">
        <AssetLibrary
          tracks={tracks}
          onAddAsset={(trackId, startTime, duration, asset) => {
            // Set current time to the start time
            setCurrentTime(startTime / 1000);

            let defaultProps: any = {};
            let finalTrackType = asset.type;

            if (asset.type === 'image') {
              defaultProps = pictureItemDefault;
            } else if (asset.type === 'video') {
              defaultProps = videoItemDefault;
            } else if (asset.type === 'audio') {
              defaultProps = audioItemDefault;
            } else if (asset.type === 'geojson') {
              defaultProps = geojsonItemDefault;
              finalTrackType = 'vector';
            } else if (asset.type === 'raster') {
              defaultProps = imageRasterItemDefault;
            }

            const newClip = {
              ...defaultProps,
              id: crypto.randomUUID(),
              label: asset.name,
              color: 'bg-blue-500/50 border-blue-500',
              start: startTime / 1000,
              width: duration / 1000,
              content: asset.url,
              trackType: finalTrackType
            };

            if (asset.type === 'video') {
              newClip.color = 'bg-purple-500/50 border-purple-500';
            } else if (asset.type === 'audio') {
              newClip.color = 'bg-green-500/50 border-green-500';
            }

            setTracks((prev) =>
              prev.map((track) => {
                if (track.id === trackId) {
                  return {
                    ...track,
                    clips: [...track.clips, newClip]
                  };
                }
                return track;
              })
            );
          }}
        />

        <main className="flex-1 flex flex-col min-h-0 min-w-0">
          <div className="flex-1 flex min-h-0">
            <SceneCanvas />
            <PropertyPanel />
          </div>

          <Timeline
            tracks={tracks}
            selectedClipId={selectedClip?.id}
            currentTime={currentTime}
            onTimeChange={(t) =>
              setCurrentTime(Math.min(Math.max(0, t), totalDuration))
            }
            onToggleVisibility={handleToggleVisibility}
            onDeleteTrack={handleDeleteTrack}
            onDeleteClip={handleDeleteClip}
            onClipSelect={handleClipSelect}
            onClipChange={handleClipChange}
            onDrop={handleAssetDrop}
            onAddTrack={handleAddTrack}
          />
        </main>
      </div>
    </div>
  );
}
