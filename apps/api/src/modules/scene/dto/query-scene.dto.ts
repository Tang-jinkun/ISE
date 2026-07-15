import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { SceneType } from '@prisma/client';

export class QuerySceneDto {
  @ApiProperty({ description: '搜索关键词（标题）', required: false })
  @IsString()
  @IsOptional()
  keyword?: string;

  @ApiProperty({ description: '场景类型', enum: SceneType, required: false })
  @IsEnum(SceneType)
  @IsOptional()
  type?: SceneType;
}
