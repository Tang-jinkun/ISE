import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWarDataStore } from './warDataStore';

// Mock the mock data files
vi.mock('@/mock/313mock/chibi_battle.mock', () => ({
  CHIBI_BATTLE_DATA: { war_name: '赤壁之战', outline: [] }
}));

vi.mock('@/mock/313mock/hainan_battle.mock', () => ({
  HAINAN_BATTLE_DATA: { war_name: '海南岛战役', outline: [] }
}));

vi.mock('@/mock/313mock/nuoman_battle.mock', () => ({
  NUOMAN_BATTLE_DATA: { war_name: '诺曼底登陆', outline: [] }
}));

describe('useWarDataStore', () => {
  beforeEach(() => {
    useWarDataStore.setState(useWarDataStore.getInitialState());
  });

  it('should initialize with default state', () => {
    const state = useWarDataStore.getState();
    expect(state.currentData.war_name).toBe('赤壁之战');
    expect(state.currentKey).toBe('chibi');
    expect(state.isLoading).toBe(false);
  });

  it('should switch to chibi dataset correctly', async () => {
    const store = useWarDataStore.getState();
    await store.switchMockDataset('chibi');

    const newState = useWarDataStore.getState();
    expect(newState.currentKey).toBe('chibi');
    expect(newState.currentData?.war_name).toBe('赤壁之战');
    expect(newState.isLoading).toBe(false);
  });

  it('should switch to hainan dataset correctly', async () => {
    const store = useWarDataStore.getState();
    await store.switchMockDataset('hainan');

    const newState = useWarDataStore.getState();
    expect(newState.currentKey).toBe('hainan');
    expect(newState.currentData?.war_name).toBe('海南岛战役');
  });

  it('should switch to nuoman dataset correctly', async () => {
    const store = useWarDataStore.getState();
    await store.switchMockDataset('nuoman');

    const newState = useWarDataStore.getState();
    expect(newState.currentKey).toBe('nuoman');
    expect(newState.currentData?.war_name).toBe('诺曼底登陆');
  });

  it('should set loading state during switch', async () => {
    const store = useWarDataStore.getState();
    const promise = store.switchMockDataset('chibi');

    expect(useWarDataStore.getState().isLoading).toBe(true);
    await promise;
    expect(useWarDataStore.getState().isLoading).toBe(false);
  });
});
