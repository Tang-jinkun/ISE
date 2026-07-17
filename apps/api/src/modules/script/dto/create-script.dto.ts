import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { OwnerType } from '@prisma/client';
import { Transform } from 'class-transformer';

export class CreateScriptDto {
  @ApiProperty({ description: '脚本标题', example: '我的脚本' })
  @IsString()
  @IsNotEmpty({ message: '标题不能为空' })
  title: string;

  @ApiPropertyOptional({ description: '脚本配置', default: '{}' })
  @IsOptional()
  @Transform(({ value }) => value && typeof value === 'object' ? JSON.stringify(value) : value)
  @IsString()
  config?: string;

  @ApiPropertyOptional({ description: '脚本类型', default: 'default' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiProperty({ description: '拥有者类型', enum: OwnerType, default: OwnerType.PERSON })
  @IsEnum(OwnerType)
  @IsOptional()
  ownerType?: OwnerType;

  @ApiPropertyOptional({ description: '可见对话记录' })
  @IsOptional()
  @IsArray()
  conversation?: Array<{ role: string; content: string }>;
}
