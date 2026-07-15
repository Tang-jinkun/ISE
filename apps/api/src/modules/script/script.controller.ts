import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { ScriptService } from './script.service';
import { CreateScriptDto } from './dto/create-script.dto';
import { UpdateScriptDto } from './dto/update-script.dto';
import { QueryScriptDto } from './dto/query-script.dto';
import { ScriptResponseDto } from './dto/response-script.dto';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { responseMessage } from '@/utils';

@ApiTags('脚本管理')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
@ApiHeader({
  name: 'Authorization',
  required: true,
  description: 'Bearer access_token',
})
@Controller('script')
export class ScriptController {
  constructor(private readonly scriptService: ScriptService) {}

  @Post()
  @ApiOperation({ summary: '创建脚本' })
  @ApiOkResponse({ type: ScriptResponseDto })
  async create(@Body() createScriptDto: CreateScriptDto, @Req() req: Request & { user?: any }) {
    const userId = req.user.sub;
    const data = await this.scriptService.create(userId, createScriptDto);
    return responseMessage(data, '创建成功');
  }

  @Get('list')
  @ApiOperation({ summary: '获取脚本列表' })
  @ApiOkResponse({ type: ScriptResponseDto, isArray: true })
  async findAll(@Query() query: QueryScriptDto, @Req() req: Request & { user?: any }) {
    const userId = req.user.sub;
    const data = await this.scriptService.findAll(userId, query);
    return responseMessage(data);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取脚本详情' })
  @ApiOkResponse({ type: ScriptResponseDto })
  async findOne(@Param('id') id: string, @Req() req: Request & { user?: any }) {
    const userId = req.user.sub;
    const data = await this.scriptService.findOne(userId, id);
    return responseMessage(data);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新脚本' })
  @ApiOkResponse({ type: ScriptResponseDto })
  async update(
    @Param('id') id: string,
    @Body() updateScriptDto: UpdateScriptDto,
    @Req() req: Request & { user?: any },
  ) {
    const userId = req.user.sub;
    const data = await this.scriptService.update(userId, id, updateScriptDto);
    return responseMessage(data, '更新成功');
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除脚本' })
  async remove(@Param('id') id: string, @Req() req: Request & { user?: any }) {
    const userId = req.user.sub;
    await this.scriptService.remove(userId, id);
    return responseMessage(null, '删除成功');
  }
}
