import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Put,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { SceneService } from './scene.service';
import { CreateSceneDto } from './dto/create-scene.dto';
import { UpdateSceneDto } from './dto/update-scene.dto';
import { QuerySceneDto } from './dto/query-scene.dto';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { responseMessage } from '@/utils';

@ApiTags('场景管理')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
@ApiHeader({
  name: 'Authorization',
  required: true,
  description: 'Bearer access_token',
})
@Controller('scene')
export class SceneController {
  constructor(private readonly sceneService: SceneService) {}

  @Post()
  @ApiOperation({ summary: '创建场景' })
  async create(@Body() createSceneDto: CreateSceneDto, @Req() req: Request & { user?: any }) {
    const userId = req.user.sub;
    const data = await this.sceneService.create(userId, createSceneDto);
    return responseMessage(data, '创建成功');
  }

  @Get('list')
  @ApiOperation({ summary: '获取场景列表' })
  async findAll(@Query() query: QuerySceneDto, @Req() req: Request & { user?: any }) {
    const userId = req.user.sub;
    const data = await this.sceneService.findAll(userId, query);
    return responseMessage(data);
  }

  @Get()
  @ApiOperation({ summary: '获取场景列表（别名：支持 /scene?xxx 访问）' })
  async findAllAlias(@Query() query: QuerySceneDto, @Req() req: Request & { user?: any }) {
    const userId = req.user.sub;
    const data = await this.sceneService.findAll(userId, query);
    return responseMessage(data);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取场景详情' })
  async findOne(@Param('id') id: string, @Req() req: Request & { user?: any }) {
    const userId = req.user.sub;
    const data = await this.sceneService.findOne(userId, id);
    return responseMessage(data);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新场景' })
  async update(
    @Param('id') id: string,
    @Body() updateSceneDto: UpdateSceneDto,
    @Req() req: Request & { user?: any },
  ) {
    const userId = req.user.sub;
    const data = await this.sceneService.update(userId, id, updateSceneDto);
    return responseMessage(data, '更新成功');
  }

  @Put(':id')
  @ApiOperation({ summary: '更新场景（PUT 别名）' })
  async updatePut(
    @Param('id') id: string,
    @Body() updateSceneDto: UpdateSceneDto,
    @Req() req: Request & { user?: any },
  ) {
    const userId = req.user.sub;
    const data = await this.sceneService.update(userId, id, updateSceneDto);
    return responseMessage(data, '更新成功');
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除场景' })
  async remove(@Param('id') id: string, @Req() req: Request & { user?: any }) {
    const userId = req.user.sub;
    await this.sceneService.remove(userId, id);
    return responseMessage(null, '删除成功');
  }
}
