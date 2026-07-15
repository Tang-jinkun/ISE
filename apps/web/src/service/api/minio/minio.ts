import { http } from '@/api/http';

export const readMinioFile = async (params: { objectName: string }) => {
  // Placeholder implementation
  return http.get<any>('file/read', params);
};
