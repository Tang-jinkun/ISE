import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req, Query } from '@nestjs/common';
import { FolderService } from './folder.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';
import { QueryFolderDto } from './dto/query-folder.dto';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { responseMessage } from '@/utils';

@ApiTags('文件夹管理')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
@ApiHeader({
  name: 'Authorization',
  required: true,
  description: 'Bearer access_token',
})
@Controller('folder')
export class FolderController {
  constructor(private readonly folderService: FolderService) {}

  @Post()
  @ApiOperation({ summary: '创建文件夹' })
  async create(@Body() createFolderDto: CreateFolderDto, @Req() req: Request & { user?: any }) {
    const userId = req.user.sub;
    const data = await this.folderService.create(userId, createFolderDto);
    return responseMessage(data, '创建成功');
  }

  @Get('list')
  @ApiOperation({ summary: '获取文件夹列表（含文件）' })
  async findAll(@Query() query: QueryFolderDto, @Req() req: Request & { user?: any }) {
    const userId = req.user.sub;
    const data = await this.folderService.findAll(userId, query);
    return responseMessage(data);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取文件夹详情' })
  async findOne(@Param('id') id: string, @Req() req: Request & { user?: any }) {
    const userId = req.user.sub;
    const data = await this.folderService.findOne(userId, id);
    return responseMessage(data);
  }

  @Patch(':id')
  @ApiOperation({ summary: '重命名文件夹' })
  async update(
    @Param('id') id: string,
    @Body() updateFolderDto: UpdateFolderDto,
    @Req() req: Request & { user?: any },
  ) {
    const userId = req.user.sub;
    const data = await this.folderService.update(userId, id, updateFolderDto);
    return responseMessage(data, '更新成功');
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除文件夹（需为空）' })
  async remove(@Param('id') id: string, @Req() req: Request & { user?: any }) {
    const userId = req.user.sub;
    await this.folderService.remove(userId, id);
    return responseMessage(null, '删除成功');
  }
}
