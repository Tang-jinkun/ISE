import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OwnerType } from '@prisma/client';
import { Transform } from 'class-transformer';

export class UpdateScriptDto {
  @ApiProperty({ description: '脚本标题', required: false })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({ description: '脚本配置', required: false })
  @IsString()
  @IsOptional()
  @Transform(({ value }) => value && typeof value === 'object' ? JSON.stringify(value) : value)
  config?: string;

  @ApiProperty({ description: '脚本类型', required: false })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiProperty({ description: '拥有者类型', enum: OwnerType, required: false })
  @IsEnum(OwnerType)
  @IsOptional()
  ownerType?: OwnerType;

  @ApiProperty({
    description: '与大模型 Agent 的交互对话（JSON）',
    required: false,
    example: [
      { role: 'user', content: '新的问题...' },
      { role: 'assistant', content: '新的回答...' },
    ],
  })
  @IsOptional()
  conversation?: any;
}
