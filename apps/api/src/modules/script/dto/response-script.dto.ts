import { ApiProperty } from '@nestjs/swagger';
import { OwnerType } from '@prisma/client';

export class ScriptResponseDto {
  @ApiProperty({ description: '脚本ID' })
  id: string;

  @ApiProperty({ description: '脚本标题' })
  title: string;

  @ApiProperty({ description: '脚本配置（字符串，可为 JSON 字符串）' })
  config: string;

  @ApiProperty({ description: '脚本类型，例如 python、js 等' })
  type: string;

  @ApiProperty({ description: '拥有者类型', enum: OwnerType })
  ownerType: OwnerType;

  @ApiProperty({ description: '所属用户ID' })
  userId: string;

  @ApiProperty({
    description: '与大模型 Agent 的交互对话（JSON）',
    required: false,
    example: [
      { role: 'user', content: '帮我生成一个测试脚本' },
      { role: 'assistant', content: '这是一个示例脚本...' },
    ],
  })
  conversation?: any;

  @ApiProperty({ description: '创建时间' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt: Date;
}
