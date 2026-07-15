import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { MinioService } from '@/minio/minio.service';
import { SaveMinioFile } from '@/minio/dto/save_minio.dto';
import { UpdateFileDto } from './dto/update-file.dto';

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

  private normalizeFilename(name: string) {
    try {
      const decoded = Buffer.from(name, 'latin1').toString('utf8');
      return decoded;
    } catch {
      return name;
    }
  }

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
    const { userId, folderId, fileType, file } = options;
    const email = await this.getUserEmail(userId);
    const fileName = this.normalizeFilename(file.originalname);
    const targetFolderId =
      folderId && folderId !== '' ? folderId : await this.ensureRootFolder(userId);

    const rawType = file.mimetype || '';
    let computedType = 'application';

    // GeoJSON / JSON detection
    let isGeoJson = false;
    let isJson = false;
    if (
      rawType.includes('json') ||
      file.originalname.toLowerCase().endsWith('.json') ||
      file.originalname.toLowerCase().endsWith('.geojson')
    ) {
      try {
        const content = file.buffer.toString('utf8');
        const json = JSON.parse(content);
        isJson = true;

        const geoJsonTypes = [
          'Feature',
          'FeatureCollection',
          'Point',
          'MultiPoint',
          'LineString',
          'MultiLineString',
          'Polygon',
          'MultiPolygon',
          'GeometryCollection',
        ];

        if (json && typeof json === 'object' && json.type && geoJsonTypes.includes(json.type)) {
          isGeoJson = true;
        }
      } catch {
        // ignore
      }
    }

    if (isGeoJson) {
      computedType = 'geojson';
    } else if (isJson) {
      computedType = 'json';
    } else if (rawType.startsWith('image/')) {
      computedType = rawType === 'image/tiff' ? 'imageraster' : 'image';
    } else if (rawType.startsWith('audio/')) {
      computedType = 'audio';
    } else if (rawType.startsWith('video/')) {
      computedType = 'video';
    } else if (rawType.startsWith('text/')) {
      computedType = 'text';
    } else if (rawType.startsWith('application/')) {
      computedType = 'application';
    }
    const finalType = fileType ?? computedType;

    const body: SaveMinioFile = {
      folder: email,
      file_type: finalType,
      file_name: fileName,
    };

    const result = await this.minioService.uploadFile(body, file.buffer);

    const created = await this.prisma.file.create({
      data: {
        name: fileName,
        oldName: fileName,
        folderId: targetFolderId,
        src: result.objectName,
        type: finalType,
        size: file.size,
        userId,
        tags: [],
      },
    });

    return created;
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
