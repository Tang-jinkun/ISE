import { http, type ResType } from './http';

export type FolderItem = {
  id: string;
  name: string;
  parentId?: string;
  createdAt?: string;
  children?: FolderItem[];
  files?: any[];
};

export const createFolder = (data: { name: string; parentId?: string }) =>
  http.post<FolderItem>('folder', data);

export const listFolders = (params?: {
  parentId?: string;
  withFiles?: boolean;
}): Promise<ResType<{ folders: FolderItem[]; files: any[] }>> =>
  http.get('folder/list', params);

export const getFolder = (id: string): Promise<ResType<FolderItem>> =>
  http.get<FolderItem>(`folder/${id}`);

export const renameFolder = (id: string, data: { name?: string; parentId?: string }) =>
  http.patch<FolderItem>(`folder/${id}`, data);

export const moveFolder = (id: string, parentId: string) =>
  renameFolder(id, { parentId });


export const deleteFolder = (id: string) => http.delete<null>(`folder/${id}`);
