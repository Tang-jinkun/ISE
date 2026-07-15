import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { OwnerType, SceneType } from '@prisma/client';

export class CreateSceneDto {
  @ApiProperty({ description: '场景标题', example: '我的新场景' })
  @IsString()
  @IsNotEmpty({ message: '标题不能为空' })
  title: string;

  @ApiProperty({ description: '拥有者类型', enum: OwnerType, default: OwnerType.PERSON })
  @IsEnum(OwnerType)
  @IsOptional()
  ownerType?: OwnerType;

  @ApiProperty({ description: '场景类型（公开/私有）', enum: SceneType, default: SceneType.PRIVATE })
  @IsEnum(SceneType)
  @IsOptional()
  type?: SceneType;

  @ApiProperty({ description: '配置信息', required: false, default: [] })
  @IsOptional()
  config?: any;
}
