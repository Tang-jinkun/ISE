import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';
import { QueryFolderDto } from './dto/query-folder.dto';

@Injectable()
export class FolderService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureRootFolder(userId: string) {
    let root = await this.prisma.folder.findFirst({
      where: { userId, parentId: null, name: 'root' },
    });
    if (!root) {
      root = await this.prisma.folder.create({
        data: {
          name: 'root',
          parentId: null,
          userId,
          type: 'folder',
          size: '-',
        },
      });
    }
    return root.id;
  }

  /**
   * 创建文件夹
   */
  async create(userId: string, createFolderDto: CreateFolderDto) {
    const { name, parentId } = createFolderDto;

    // 如果有 parentId，检查父文件夹是否存在
    if (parentId && parentId !== 'root') {
      const parent = await this.prisma.folder.findFirst({
        where: { id: parentId, userId },
      });
      if (!parent) {
        throw new NotFoundException('父文件夹不存在');
      }
    }

    return this.prisma.folder.create({
      data: {
        name,
        parentId: parentId === 'root' ? null : parentId,
        userId,
        // 其他字段如 type, size 默认为 schema 中定义的 'folder' 和 '-'
      },
    });
  }

  /**
   * 获取文件夹列表（包含该层级的文件夹和文件）
   * 这里的逻辑是：查指定 parentId 下的 folders 和 files
   */
  async findAll(userId: string, query: QueryFolderDto) {
    const { parentId } = query;
    // 如果 parentId 是 "root" 或者 undefined，则查询 parentId 为 null 的记录
    // 注意：Prisma 中 null 需要显式处理
    const actualParentId = (!parentId || parentId === 'root') ? null : parentId;

    // 查子文件夹
    const folders = await this.prisma.folder.findMany({
      where: {
        userId,
        parentId: actualParentId,
      },
      orderBy: { createdAt: 'desc' },
    });

    // 查该层级的文件
    // 在当前实现中，根目录使用实际的 root 文件夹 id
    const fileFolderId = actualParentId ?? await this.ensureRootFolder(userId);

    const files = await this.prisma.file.findMany({
      where: {
        userId,
        folderId: fileFolderId,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      folders,
      files,
    };
  }

  /**
   * 获取单个文件夹详情
   */
  async findOne(userId: string, id: string) {
    const folder = await this.prisma.folder.findFirst({
      where: { id, userId },
    });
    if (!folder) {
      throw new NotFoundException('文件夹不存在');
    }
    return folder;
  }

  /**
   * 更新文件夹（重命名）
   */
  async update(userId: string, id: string, updateFolderDto: UpdateFolderDto) {
    await this.findOne(userId, id); // 检查是否存在

    return this.prisma.folder.update({
      where: { id },
      data: { name: updateFolderDto.name },
    });
  }

  /**
   * 删除文件夹
   * 简单策略：如果有子文件或子文件夹，可以阻止删除，或者递归删除。
   * 这里先实现简单的：如果非空则提示，或者直接利用 Prisma 的级联删除（如果配置了的话）。
   * 目前 Schema 中没有配置 onDelete: Cascade。
   *
   * 我们先实现：删除该文件夹记录。
   * 实际业务中通常需要级联删除，这里为了安全先只删除文件夹本身，
   * 如果数据库有约束会报错，或者变成孤儿数据。
   *
   * 改进：检查是否有子内容，如果有则提示先删除子内容。
   */
  async remove(userId: string, id: string) {
    const folder = await this.findOne(userId, id);

    // 检查是否有子文件夹
    const childFolders = await this.prisma.folder.count({
      where: { parentId: id },
    });

    // 检查是否有子文件
    const childFiles = await this.prisma.file.count({
      where: { folderId: id },
    });

    if (childFolders > 0 || childFiles > 0) {
        // 这里可以选择递归删除，或者抛出错误让用户手动清空
        // 为了方便，这里暂时抛出错误
        throw new Error('文件夹不为空，请先清空内容');
    }

    return this.prisma.folder.delete({
      where: { id },
    });
  }
}
