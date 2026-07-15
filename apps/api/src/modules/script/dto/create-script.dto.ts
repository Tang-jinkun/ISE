import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { OwnerType } from '@prisma/client';

export class CreateScriptDto {
  @ApiProperty({ description: '脚本标题', example: '我的脚本' })
  @IsString()
  @IsNotEmpty({ message: '标题不能为空' })
  title: string;

  @ApiProperty({ description: '脚本配置', example: '{}', required: false })
  @IsString()
  @IsNotEmpty({ message: '配置不能为空' })
  @IsOptional()
  config?: string;

  @ApiProperty({ description: '脚本类型', example: 'python', required: false })
  @IsString()
  @IsNotEmpty({ message: '类型不能为空' })
  @IsOptional()
  type?: string;

  @ApiProperty({ description: '拥有者类型', enum: OwnerType, default: OwnerType.PERSON })
  @IsEnum(OwnerType)
  @IsOptional()
  ownerType?: OwnerType;

  @ApiProperty({
    description: '与大模型 Agent 的交互对话（JSON）',
    required: false,
    example: [
      { role: 'user', content: '帮我生成一个测试脚本' },
      { role: 'assistant', content: '好的，这是一个示例脚本...' },
    ],
  })
  @IsOptional()
  conversation?: any;
}
