/**
 * @description: minio 删除文件管理
 */
export class ParamMinioFile {
  folder:
    | 'avatar-folder'
    | 'taskdata-folder'
    | 'macrodata-folder'
    | 'basicinfo-folder'
    | 'task-meta-data'
    | any;
  file_type: 'remote-data' | 'missile-data' | 'flight-data' | 'target-data' | any;
  file_name: string;
}
