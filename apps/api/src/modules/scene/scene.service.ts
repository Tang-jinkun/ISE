import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sceneProjectConfigSchema } from '@ise/runtime-contracts';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateSceneDto } from './dto/create-scene.dto';
import { UpdateSceneDto } from './dto/update-scene.dto';
import { QuerySceneDto } from './dto/query-scene.dto';

@Injectable()
export class SceneService {
  constructor(private readonly prisma: PrismaService) {}

  private validateConfig(config: unknown) {
    const result = sceneProjectConfigSchema.safeParse(config);
    if (!result.success) {
      throw new BadRequestException('Invalid scene config');
    }
    return result.data;
  }

  async create(userId: string, createSceneDto: CreateSceneDto) {
    const config =
      createSceneDto.config === undefined ? undefined : this.validateConfig(createSceneDto.config);
    return this.prisma.scene.create({
      data: {
        ...createSceneDto,
        ...(config !== undefined ? { config } : {}),
        userId,
      },
    });
  }

  async findAll(userId: string, query: QuerySceneDto) {
    const { keyword, type } = query;
    return this.prisma.scene.findMany({
      where: {
        userId,
        ...(keyword ? { title: { contains: keyword } } : {}),
        ...(type ? { type } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(userId: string, id: string) {
    const scene = await this.prisma.scene.findFirst({
      where: { id, userId },
    });
    if (!scene) {
      throw new NotFoundException('场景不存在');
    }
    return scene;
  }

  async update(userId: string, id: string, updateSceneDto: UpdateSceneDto) {
    await this.findOne(userId, id);

    const { title, type, config } = updateSceneDto;
    const data: any = {};
    if (title !== undefined) data.title = title;
    if (type !== undefined) data.type = type;
    if (config !== undefined) data.config = this.validateConfig(config);

    return this.prisma.scene.update({
      where: { id },
      data,
    });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    return this.prisma.scene.delete({
      where: { id },
    });
  }
}
