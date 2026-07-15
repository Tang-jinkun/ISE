import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class QueryFolderDto {
  @ApiProperty({ description: '父文件夹ID，查询根目录传 "root" 或不传', required: false })
  @IsString()
  @IsOptional()
  parentId?: string;
}
