import { SceneItem } from '@/api/scene';
import { create } from 'zustand';

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
  setCurrentScene: (scene: SceneItem | null) => void;
  updateCurrentScene: (updates: Partial<SceneItem>) => void;
  setSelectedClip: (clip: SelectedClip | null) => void;
  updateSelectedClip: (updates: Partial<SelectedClip>) => void;
}

export const useSceneStore = create<SceneState>((set) => ({
  currentScene: null,
  selectedClip: null,
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
    }))
}));
