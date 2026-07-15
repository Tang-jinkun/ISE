import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateFolderDto {
  @ApiProperty({ description: '文件夹名称', example: '新建文件夹' })
  @IsString()
  @IsNotEmpty({ message: '文件夹名称不能为空' })
  name: string;

  @ApiProperty({ description: '父文件夹ID，根目录不传或传空字符串', required: false, example: 'uuid' })
  @IsString()
  @IsOptional()
  parentId?: string;
}
