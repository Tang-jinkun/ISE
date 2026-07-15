import {
  type SceneProjectConfig,
  type SceneTrackItem,
  sceneProjectConfigSchema,
} from '@ise/runtime-contracts';
import { create } from 'zustand';
import type { SceneItem } from '@/api/scene';

export interface SelectedClip {
  id: string;
  label: string;
  trackId: string;
  trackType: string;
  start: number;
  width: number;
  color?: string;
  [key: string]: any;
}

interface SceneState {
  currentScene: SceneItem | null;
  selectedClip: SelectedClip | null;
  config: SceneProjectConfig | null;
  setCurrentScene: (scene: SceneItem | null) => void;
  updateCurrentScene: (updates: Partial<SceneItem>) => void;
  setSelectedClip: (clip: SelectedClip | null) => void;
  updateSelectedClip: (updates: Partial<SelectedClip>) => void;
  setConfig: (config: SceneProjectConfig) => void;
  updateTrackItem: (
    trackId: string,
    itemId: string,
    updates: Partial<SceneTrackItem>,
  ) => void;
  removeTrackItem: (trackId: string, itemId: string) => void;
}

export const useSceneStore = create<SceneState>((set) => ({
  currentScene: null,
  selectedClip: null,
  config: null,
  setCurrentScene: (scene) => set({ currentScene: scene }),
  updateCurrentScene: (updates) =>
    set((state) => ({
      currentScene: state.currentScene
        ? { ...state.currentScene, ...updates }
        : null
    })),
  setSelectedClip: (clip) => set({ selectedClip: clip }),
  updateSelectedClip: (updates) =>
    set((state) => ({
      selectedClip: state.selectedClip
        ? { ...state.selectedClip, ...updates }
        : null
    })),
  setConfig: (config) => set({ config: sceneProjectConfigSchema.parse(config) }),
  updateTrackItem: (trackId, itemId, updates) =>
    set((state) => {
      if (!state.config) return state;

      const candidate = {
        ...state.config,
        tracks: state.config.tracks.map((track) =>
          track.trackId === trackId
            ? {
                ...track,
                items: track.items.map((item) =>
                  item.id === itemId ? { ...item, ...updates } : item,
                ),
              }
            : track,
        ),
      };

      return { config: sceneProjectConfigSchema.parse(candidate) };
    }),
  removeTrackItem: (trackId, itemId) =>
    set((state) => {
      if (!state.config) return state;

      const candidate = {
        ...state.config,
        tracks: state.config.tracks.map((track) =>
          track.trackId === trackId
            ? { ...track, items: track.items.filter((item) => item.id !== itemId) }
            : track,
        ),
      };

      return { config: sceneProjectConfigSchema.parse(candidate) };
    }),
}));
