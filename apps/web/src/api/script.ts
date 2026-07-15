import { http, type ResType } from './http';

export type ConversationItem = {
  role: 'user' | 'assistant';
  content: string;
};

export type ScriptItem = {
  id: string;
  title?: string;
  name?: string;
  type?: string;
  coverUrl?: string;
  updatedAt?: string;
  config?: string;
  ownerType?: string;
  conversation?: ConversationItem[];
};

export type ScriptListQuery = {
  page?: number;
  pageSize?: number;
  keyword?: string;
};

export type UpdateScriptPayload = {
  title?: string;
  config?: string;
  type?: string;
  ownerType?: string;
  conversation?: ConversationItem[];
};

export const createScript = (data: { title: string }) =>
  http.post<ScriptItem>('script', data);

export const getScript = (id: string): Promise<ResType<ScriptItem>> =>
  http.get<ScriptItem>(`script/${id}`);

export const updateScript = (
  id: string,
  data: UpdateScriptPayload
): Promise<ResType<ScriptItem>> => http.patch<ScriptItem>(`script/${id}`, data);

export const listScripts = (
  params?: ScriptListQuery
): Promise<ResType<ScriptItem[]>> =>
  http.get<ScriptItem[]>('script/list', params);

export const deleteScript = (id: string) => http.delete<null>(`script/${id}`);
