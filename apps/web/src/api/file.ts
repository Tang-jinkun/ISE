import { http, type ResType } from './http';

export type FileItem = {
  id: string;
  name: string;
  fileType: string;
  size?: number;
  createdAt?: string;
  folderId?: string;
  url?: string;
  tags?: string[];
};

export const uploadFile = (
  file: File,
  options: { folderId?: string; fileType: string },
  onProgress?: (p: number) => void
) => {
  const form = new FormData();
  form.append('file', file);
  form.append('fileType', options.fileType);
  if (options.folderId) form.append('folderId', options.folderId);

  return http.post<FileItem>('file/upload', form, undefined, (evt) => {
    if (evt.total) {
      const p = Math.round((evt.loaded / evt.total) * 100);
      onProgress?.(p);
    }
  });
};

export const listFiles = (params?: {
  folderId?: string;
  fileType?: string;
}): Promise<ResType<FileItem[]>> => {
  return http.get<FileItem[]>('file/list', params);
};

export const deleteFile = (id: string) => http.delete<null>(`file/${id}`);

export const updateFile = (
  id: string,
  data: { name?: string; folderId?: string; tags?: string[] }
) => http.patch<FileItem>(`file/${id}`, data);
