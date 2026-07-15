import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
  type AxiosProgressEvent
} from 'axios';
import { message } from '@/components/ui/message';

export type ResType<T> = {
  code?: number;
  msg?: string;
  message?: string;
  data: T;
};

export interface Http {
  get<T>(
    url: string,
    params?: unknown,
    responseType?: any
  ): Promise<ResType<T>>;
  post<T>(
    url: string,
    data?: unknown,
    cancelToken?: any,
    progressFunction?: (progressEvent: AxiosProgressEvent) => void
  ): Promise<ResType<T>>;
  delete<T>(url: string, config?: AxiosRequestConfig): Promise<ResType<T>>;
  patch<T>(url: string, data?: unknown): Promise<ResType<T>>;
  registerFunction<T>(url: string, params?: unknown): Promise<ResType<T>>;
}

const BASE_URL = (import.meta as any).env?.API_BASE || '/SceneBack/';
const TIMEOUT = 20000;

const TOKEN_KEYS = {
  access: 'access_token',
  refresh: 'refresh_token',
  register: 'register_token'
};

const getToken = (key: string) => localStorage.getItem(key) ?? '';
const setToken = (key: string, value: string) =>
  localStorage.setItem(key, value);
const removeToken = (key: string) => localStorage.removeItem(key);
export const tokenStorage = {
  keys: TOKEN_KEYS,
  getToken,
  setToken,
  removeToken
};

const axiosInstance: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: TIMEOUT
});

let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

const subscribeTokenRefresh = (cb: (token: string) => void) => {
  refreshSubscribers.push(cb);
};

const onRefreshed = (token: string) => {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
};

const refreshAccessToken = async (refreshToken: string) => {
  const resp = await axios.post<
    ResType<{ access_token: string; refresh_token?: string }>
  >(
    `${BASE_URL}auth/refresh`,
    { refresh_token: refreshToken },
    { timeout: TIMEOUT }
  );
  const data = resp.data.data;
  if (data?.access_token) {
    setToken(TOKEN_KEYS.access, data.access_token);
    if (data.refresh_token) setToken(TOKEN_KEYS.refresh, data.refresh_token);
    return data.access_token;
  }
  throw new Error('refresh failed');
};

axiosInstance.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const access = getToken(TOKEN_KEYS.access);
    if (access) {
      config.headers = config.headers || {};
      (config.headers as any)['Authorization'] = `Bearer ${access}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

axiosInstance.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    const resp = error.response as AxiosResponse | undefined;
    const originalRequest: AxiosRequestConfig & { _retry?: boolean } =
      error.config || {};

    if (resp?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const refresh = getToken(TOKEN_KEYS.refresh);

      if (!refresh) {
        removeToken(TOKEN_KEYS.access);
        removeToken(TOKEN_KEYS.refresh);
        message.error('未登录或登录信息过期，请重新登录');
        window.location.href = '/login';
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve) => {
          subscribeTokenRefresh((token: string) => {
            originalRequest.headers = originalRequest.headers || {};
            (originalRequest.headers as any)[
              'Authorization'
            ] = `Bearer ${token}`;
            resolve(axiosInstance.request(originalRequest));
          });
        });
      }

      try {
        isRefreshing = true;
        const newToken = await refreshAccessToken(refresh);
        isRefreshing = false;
        onRefreshed(newToken);
        originalRequest.headers = originalRequest.headers || {};
        (originalRequest.headers as any)[
          'Authorization'
        ] = `Bearer ${newToken}`;
        return axiosInstance.request(originalRequest);
      } catch (e) {
        isRefreshing = false;
        removeToken(TOKEN_KEYS.access);
        removeToken(TOKEN_KEYS.refresh);
        message.error('登录信息过期，请重新登录');
        window.location.href = '/login';
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

export const validateaccess_token = async (accessToken: string) => {
  const resp = await axios.post<ResType<{ valid: boolean }>>(
    `${BASE_URL}auth/validate`,
    { access_token: accessToken },
    { timeout: TIMEOUT }
  );
  return Boolean(resp.data?.data?.valid);
};

export const refreshaccess_token = async (refreshToken: string) => {
  const token = await refreshAccessToken(refreshToken);
  return {
    access_token: token,
    refresh_token: getToken(TOKEN_KEYS.refresh)
  };
};

export const http: Http = {
  get<T>(
    url: string,
    params?: unknown,
    responseType?: any
  ): Promise<ResType<T>> {
    return axiosInstance
      .get<ResType<T>>(url, { params, responseType: responseType ?? 'json' })
      .then((res) => res.data);
  },
  post<T>(
    url: string,
    data?: unknown,
    cancelToken?: any,
    progressFunction?: (progressEvent: AxiosProgressEvent) => void
  ): Promise<ResType<T>> {
    return axiosInstance({
      url,
      data,
      method: 'post',
      cancelToken,
      onUploadProgress: progressFunction
    }).then((res) => res.data);
  },
  delete<T>(url: string, config: AxiosRequestConfig = {}): Promise<ResType<T>> {
    return axiosInstance({
      url,
      method: 'delete',
      ...config
    }).then((res) => res.data);
  },
  patch<T>(url: string, data: unknown = {}): Promise<ResType<T>> {
    return axiosInstance({
      url,
      data,
      method: 'patch'
    }).then((res) => res.data);
  },
  registerFunction<T>(url: string, data?: unknown): Promise<ResType<T>> {
    const codeAuthToken = getToken(TOKEN_KEYS.register);
    return axiosInstance({
      url,
      data,
      method: 'post',
      headers: {
        Authorization: `Bearer ${codeAuthToken}`
      }
    }).then((res) => res.data);
  }
};
