import { http, type ResType } from './http';

export type OwnerType = 'PERSON' | 'TEAM';
export type SceneType = 'PRIVATE' | 'PUBLIC';

export type SceneItem = {
  id: string;
  title: string;
  ownerType: OwnerType;
  type: SceneType;
  config: any;
  userId: string;
  createdAt: string;
  updatedAt: string;
  // Legacy fields compatibility
  name?: string;
  coverUrl?: string;
  image?: string;
};

export type SceneListQuery = {
  page?: number;
  pageSize?: number;
  keyword?: string;
};

export const createScene = (data: { title: string }) =>
  http.post<SceneItem>('scene', data);

export const listScenes = (
  params?: SceneListQuery
): Promise<ResType<SceneItem[]>> => http.get<SceneItem[]>('scene/list', params);

export const getScene = (id: string) => http.get<SceneItem>(`scene/${id}`);

export const updateScene = (id: string, data: Partial<SceneItem>) =>
  http.patch<SceneItem>(`scene/${id}`, data);

export const deleteScene = (id: string) => http.delete<null>(`scene/${id}`);
