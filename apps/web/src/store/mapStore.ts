import { create } from 'zustand';

interface MapState {
  uuid: string;
  position: any; // Can be string or array based on usage
  setUuid: (uuid: string) => void;
  setPosition: (position: any) => void;
}

export const useMapStore = create<MapState>((set) => ({
  uuid: '',
  position: '',
  setUuid: (uuid) => set({ uuid }),
  setPosition: (position) => set({ position }),
}));
