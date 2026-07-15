import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { MinioService } from '@/minio/minio.service';
import { SaveMinioFile } from '@/minio/dto/save_minio.dto';
import { UpdateFileDto } from './dto/update-file.dto';
import { validateUpload } from './upload-validation';
import { randomUUID } from 'crypto';

export interface UploadFileOptions {
  userId: string;
  folderId?: string;
  fileType?: string;
  file: Express.Multer.File;
}

export interface ListFilesOptions {
  userId: string;
  folderId?: string;
  fileType?: string;
}

@Injectable()
export class FileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minioService: MinioService,
  ) {}

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

  private async getUserEmail(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return user.email;
  }

  async upload(options: UploadFileOptions) {
    const { userId, folderId, file } = options;
    const validated = validateUpload(file);
    const email = await this.getUserEmail(userId);
    let targetFolderId: string;
    if (folderId && folderId !== '') {
      const folder = await this.prisma.folder.findFirst({
        where: { id: folderId, userId },
      });
      if (!folder) {
        throw new NotFoundException('Target folder does not exist');
      }
      targetFolderId = folder.id;
    } else {
      targetFolderId = await this.ensureRootFolder(userId);
    }

    const body: SaveMinioFile = {
      folder: email,
      file_type: validated.storageType,
      file_name: `${randomUUID()}-${validated.fileName}`,
    };

    const result = await this.minioService.uploadFile(body, validated.buffer);

    try {
      return await this.prisma.file.create({
        data: {
          name: validated.fileName,
          oldName: validated.fileName,
          folderId: targetFolderId,
          src: result.objectName,
          type: validated.storageType,
          size: validated.size,
          mimeType: validated.mimeType,
          fingerprint: validated.fingerprint,
          userId,
          tags: [],
        },
      });
    } catch (persistenceError) {
      try {
        await this.minioService.deleteFile(body);
      } catch (cleanupError) {
        throw new AggregateError(
          [persistenceError, cleanupError],
          'File metadata persistence and uploaded object cleanup both failed',
        );
      }
      throw persistenceError;
    }
  }

  async list(options: ListFilesOptions) {
    const { userId, folderId, fileType } = options;
    return this.prisma.file.findMany({
      where: {
        userId,
        ...(folderId ? { folderId } : {}),
        ...(fileType ? { type: fileType } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async readOwned(userId: string, id: string) {
    const file = await this.prisma.file.findFirst({ where: { id, userId } });
    if (!file) {
      throw new NotFoundException('File does not exist');
    }
    return {
      stream: await this.minioService.openRead(file.src),
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      fingerprint: file.fingerprint,
    };
  }

  async update(userId: string, id: string, updateDto: UpdateFileDto) {
    const file = await this.prisma.file.findFirst({
      where: { id, userId },
    });

    if (!file) {
      throw new NotFoundException('文件不存在');
    }

    if (updateDto.folderId) {
      const folder = await this.prisma.folder.findFirst({
        where: { id: updateDto.folderId, userId },
      });
      if (!folder) {
        throw new NotFoundException('目标文件夹不存在');
      }
    }

    return this.prisma.file.update({
      where: { id },
      data: {
        ...updateDto,
      },
    });
  }

  async remove(userId: string, id: string) {
    const file = await this.prisma.file.findFirst({
      where: { id, userId },
    });

    if (!file) {
      throw new NotFoundException('文件不存在');
    }

    const parts = file.src.split('/');
    const folder = parts[0] || '';
    const file_type = parts[1] || '';
    const file_name = parts.slice(2).join('/') || '';

    if (folder && file_type && file_name) {
      await this.minioService.deleteFile({ folder, file_type, file_name } as any);
    }

    await this.prisma.file.delete({
      where: { id: file.id },
    });

    return { ok: true };
  }
}
