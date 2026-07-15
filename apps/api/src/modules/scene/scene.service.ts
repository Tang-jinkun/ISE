import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateSceneDto } from './dto/create-scene.dto';
import { UpdateSceneDto } from './dto/update-scene.dto';
import { QuerySceneDto } from './dto/query-scene.dto';

@Injectable()
export class SceneService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, createSceneDto: CreateSceneDto) {
    return this.prisma.scene.create({
      data: {
        ...createSceneDto,
        userId,
      },
    });
  }

  async findAll(userId: string, query: QuerySceneDto) {
    const { keyword, type } = query;
    return this.prisma.scene.findMany({
      where: {
        userId,
        ...(keyword ? { title: { contains: keyword } } : {}), // PostgreSQL 默认区分大小写，若需忽略大小写可用 mode: 'insensitive'，需确认 prisma 版本支持
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
    if (config !== undefined) {
      // 如果 config 是字符串，尝试解析为 JSON 对象
      if (typeof config === 'string') {
        try {
          data.config = JSON.parse(config);
        } catch {
          data.config = config; // 解析失败则按原样存储（可能导致 Prisma 报错或存为字符串）
        }
      } else {
        data.config = config;
      }
    }
    // 注意：过滤掉 userId, id, createdAt, updatedAt 等不可更新或导致冲突的字段

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
