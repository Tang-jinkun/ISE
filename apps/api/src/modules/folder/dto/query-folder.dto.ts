import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class QueryFolderDto {
  @ApiProperty({ description: '父文件夹ID，查询根目录传 "root" 或不传', required: false })
  @IsString()
  @IsOptional()
  parentId?: string;

  @ApiProperty({
    description: 'Whether files should be included with the folder list',
    required: false,
    type: Boolean,
  })
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  @IsOptional()
  withFiles?: boolean;
}
