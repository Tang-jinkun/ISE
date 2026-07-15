import { create } from 'zustand';
import { getUserInfo } from '@/api/auth';
import { tokenStorage } from '@/api/http';

export type UserInfo = {
  id: string;
  email: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  role?: string;
} | null;

type UserState = {
  user: UserInfo;
  loading: boolean;
  fetchUser: () => Promise<void>;
  logout: () => void;
};

export const useUserStore = create<UserState>((set) => ({
  user: null,
  loading: false,
  fetchUser: async () => {
    set({ loading: true });
    try {
      const res = await getUserInfo();
      const data = res?.data as any;
      if (data) {
        set({
          user: {
            id: String(data.id ?? data.userId ?? ''),
            email: data.email,
            username: data.username,
            displayName: data.displayName ?? data.nickname ?? data.username,
            avatarUrl: data.avatarUrl,
            role: data.role
          },
          loading: false
        });
      } else {
        set({ user: null, loading: false });
      }
    } catch {
      set({ user: null, loading: false });
    }
  },
  logout: () => {
    tokenStorage.removeToken(tokenStorage.keys.access);
    tokenStorage.removeToken(tokenStorage.keys.refresh);
    set({ user: null, loading: false });
  }
}));
