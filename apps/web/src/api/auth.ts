import { http, tokenStorage, type ResType } from './http';

export type Tokens = {
  access_token: string;
  refresh_token: string;
};

export const register = async (params: {
  email: string;
  password: string;
  username: string;
}): Promise<ResType<Tokens>> => {
  const res = await http.post<Tokens>('auth/register', params);
  if (res?.data?.access_token && res?.data?.refresh_token) {
    tokenStorage.setToken(tokenStorage.keys.access, res.data.access_token);
    tokenStorage.setToken(tokenStorage.keys.refresh, res.data.refresh_token);
  }
  return res;
};

export const login = async (params: {
  email: string;
  password: string;
}): Promise<ResType<Tokens>> => {
  const res = await http.post<Tokens>('auth/login', params);
  if (res?.data?.access_token && res?.data?.refresh_token) {
    tokenStorage.setToken(tokenStorage.keys.access, res.data.access_token);
    tokenStorage.setToken(tokenStorage.keys.refresh, res.data.refresh_token);
  }
  return res;
};

export const resetPassword = (params: { email: string; password: string }) =>
  http.post<{ accepted: boolean }>('auth/reset-password', params);

export const refresh = async (refresh_token: string) =>
  http.post<Tokens>('auth/refresh', { refresh_token });

export const getUserInfo = () => http.get<any>('auth/getUserInfo');
