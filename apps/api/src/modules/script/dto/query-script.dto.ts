import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class QueryScriptDto {
  @ApiProperty({ description: '搜索关键词（标题）', required: false })
  @IsString()
  @IsOptional()
  keyword?: string;

  @ApiProperty({ description: '脚本类型', required: false })
  @IsString()
  @IsOptional()
  type?: string;
}
