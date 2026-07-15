import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ParamsState {
  showTransitions: boolean;
  setShowTransitions: (show: boolean) => void;
}

export const useParamsStore = create<ParamsState>()(
  persist(
    (set) => ({
      showTransitions: false,
      setShowTransitions: (show) => set({ showTransitions: show }),
    }),
    {
      name: 'params-ui-storage',
    }
  )
);
