import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateFolderDto {
  @ApiProperty({ description: '文件夹名称', example: '重命名文件夹' })
  @IsString()
  @IsNotEmpty({ message: '文件夹名称不能为空' })
  name: string;
}
