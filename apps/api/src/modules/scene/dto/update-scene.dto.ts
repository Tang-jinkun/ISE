import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { SceneType } from '@prisma/client';

export class UpdateSceneDto {
  @ApiProperty({ description: '场景标题', required: false })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({ description: '场景类型', enum: SceneType, required: false })
  @IsEnum(SceneType)
  @IsOptional()
  type?: SceneType;

  @ApiProperty({ description: '配置信息', required: false })
  @IsOptional()
  config?: any;
}
