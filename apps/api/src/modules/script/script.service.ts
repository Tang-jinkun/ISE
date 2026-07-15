import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateScriptDto } from './dto/create-script.dto';
import { UpdateScriptDto } from './dto/update-script.dto';
import { QueryScriptDto } from './dto/query-script.dto';

@Injectable()
export class ScriptService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, createScriptDto: CreateScriptDto) {
    const { title, config, type, ownerType, conversation } = createScriptDto;
    const data: any = {
      title,
      config: config ?? '{}',
      type: type ?? 'default',
      ownerType: ownerType ?? 'PERSON',
      userId,
    };
    if (conversation !== undefined) {
      data.conversation = conversation;
    }
    return this.prisma.script.create({ data });
  }

  async findAll(userId: string, query: QueryScriptDto) {
    const { keyword, type } = query;
    return this.prisma.script.findMany({
      where: {
        userId,
        ...(keyword ? { title: { contains: keyword } } : {}),
        ...(type ? { type } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(userId: string, id: string) {
    const script = await this.prisma.script.findFirst({
      where: { id, userId },
    });
    if (!script) {
      throw new NotFoundException('脚本不存在');
    }
    return script;
  }

  async update(userId: string, id: string, updateScriptDto: UpdateScriptDto) {
    await this.findOne(userId, id);
    return this.prisma.script.update({
      where: { id },
      data: updateScriptDto,
    });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    return this.prisma.script.delete({
      where: { id },
    });
  }
}
