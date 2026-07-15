import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, Matches } from 'class-validator';

export class UpdateFileDto {
  @ApiPropertyOptional({ description: '文件名称' })
  @IsString()
  @Matches(/^[^\u0000-\u001f\u007f-\u009f]+$/, {
    message: '文件名称不能包含控制字符',
  })
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: '文件夹ID' })
  @IsString()
  @IsOptional()
  folderId?: string;

  @ApiPropertyOptional({ description: '标签', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}
