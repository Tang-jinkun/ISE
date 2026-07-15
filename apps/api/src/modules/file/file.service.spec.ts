import { NotFoundException } from '@nestjs/common';
import { FileService } from './file.service';

jest.mock('@/prisma/prisma.service', () => ({ PrismaService: class PrismaService {} }), {
  virtual: true,
});
jest.mock('@/minio/minio.service', () => ({ MinioService: class MinioService {} }), {
  virtual: true,
});

describe('FileService upload authorization', () => {
  it('rejects a folder not owned by the uploading user before external side effects', async () => {
    const prisma = {
      file: {
        create: jest.fn(),
      },
      folder: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'owner@example.com',
        }),
      },
    };
    const minioService = {
      uploadFile: jest.fn().mockResolvedValue({
        bucket: 'test',
        objectName: 'owner@example.com/video/flight.mp4',
      }),
    };
    const service = new FileService(prisma as any, minioService as any);

    await expect(
      service.upload({
        userId: 'user-1',
        folderId: 'foreign-folder',
        fileType: 'video',
        file: {
          buffer: Buffer.from('video'),
          mimetype: 'video/mp4',
          originalname: 'flight.mp4',
          size: 5,
        } as Express.Multer.File,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.folder.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign-folder', userId: 'user-1' },
    });
    expect(minioService.uploadFile).not.toHaveBeenCalled();
    expect(prisma.file.create).not.toHaveBeenCalled();
  });
});
