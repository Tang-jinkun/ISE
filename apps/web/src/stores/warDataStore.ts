import { message } from '@/components/ui/message';
import { CHIBI_BATTLE_DATA } from '@/mock/313mock/chibi_battle.mock';
import { type BattlExampleScene_DataStructureModel } from '@/mock/core.type';
import { create } from 'zustand';

export type DatasetKey = 'chibi' | 'hainan' | 'nuoman';

interface WarDataState {
  currentData: BattlExampleScene_DataStructureModel;
  currentKey: DatasetKey;
  isLoading: boolean;
  switchMockDataset: (
    key: DatasetKey
  ) => Promise<BattlExampleScene_DataStructureModel>;
  setData: (data: BattlExampleScene_DataStructureModel) => void;
}

export const useWarDataStore = create<WarDataState>((set, get) => ({
  currentData: CHIBI_BATTLE_DATA,
  currentKey: 'chibi',
  isLoading: false,

  setData: (data) => set({ currentData: data }),

  switchMockDataset: async (key: DatasetKey) => {
    set({ isLoading: true, currentKey: key });
    try {
      let data: any;
      switch (key) {
        case 'chibi':
          // 动态导入以支持按需加载和 mock 切换
          const chibi = await import('@/mock/313mock/chibi_battle.mock');
          data = chibi.CHIBI_BATTLE_DATA;
          break;
        case 'hainan':
          const hainan = await import('@/mock/313mock/hainan_battle.mock');
          data = hainan.HAINAN_BATTLE_DATA;
          break;
        case 'nuoman':
          const nuoman = await import('@/mock/313mock/nuoman_battle.mock');
          data = nuoman.NUOMAN_BATTLE_DATA;
          break;
      }

      if (!data) throw new Error(`无法加载数据集: ${key}`);

      set({ currentData: data, isLoading: false });
      message.success(`成功切换至: ${data.war_name}`);
      return data;
    } catch (error) {
      console.error('Failed to switch dataset:', error);
      set({ isLoading: false });
      message.error('数据导入失败，请检查 Mock 文件');
      throw error;
    }
  }
}));
