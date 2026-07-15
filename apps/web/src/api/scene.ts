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

export type SceneUpdatePayload = Pick<SceneItem, 'title' | 'type' | 'config'>;

export const buildSceneUpdate = (
  scene: SceneItem,
  config: SceneItem['config'] = scene.config
): SceneUpdatePayload => ({
  title: scene.title,
  type: scene.type,
  config
});

export const createScene = (data: { title: string }) =>
  http.post<SceneItem>('scene', data);

export const listScenes = (
  params?: SceneListQuery
): Promise<ResType<SceneItem[]>> => http.get<SceneItem[]>('scene/list', params);

export const getScene = (id: string) => http.get<SceneItem>(`scene/${id}`);

export const updateScene = (id: string, data: SceneUpdatePayload) =>
  http.patch<SceneItem>(`scene/${id}`, data);

export const deleteScene = (id: string) => http.delete<null>(`scene/${id}`);
