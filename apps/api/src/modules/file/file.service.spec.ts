import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { FileService } from './file.service';
import { MAX_UPLOAD_SIZE_BYTES } from './upload-validation';

jest.mock('@/prisma/prisma.service', () => ({ PrismaService: class PrismaService {} }), {
  virtual: true,
});
jest.mock('@/minio/minio.service', () => ({ MinioService: class MinioService {} }), {
  virtual: true,
});

function makeMp4(): Buffer {
  const buffer = Buffer.alloc(20);
  buffer.writeUInt32BE(buffer.length, 0);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write('isom', 8, 'ascii');
  buffer.writeUInt32BE(0, 12);
  buffer.write('isom', 16, 'ascii');
  return buffer;
}

function uploadFile(
  buffer: Buffer,
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  return {
    buffer,
    mimetype: 'video/mp4',
    originalname: 'flight.mp4',
    size: buffer.length,
    ...overrides,
  } as Express.Multer.File;
}

function dependencies() {
  const prisma = {
    file: {
      create: jest.fn().mockResolvedValue({ id: 'file-1' }),
    },
    folder: {
      create: jest.fn(),
      findFirst: jest.fn().mockResolvedValue({ id: 'owned-folder' }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'owner@example.com',
      }),
    },
  };
  const minioService = {
    uploadFile: jest.fn().mockImplementation(async (body) => ({
      bucket: 'test',
      objectName: `${body.folder}/${body.file_type}/${body.file_name}`,
    })),
    deleteFile: jest.fn().mockResolvedValue({ ok: true }),
  };
  return { prisma, minioService };
}

describe('FileService upload security', () => {
  it('rejects a folder not owned by the uploading user before external side effects', async () => {
    const { prisma, minioService } = dependencies();
    prisma.folder.findFirst.mockResolvedValue(null);
    const service = new FileService(prisma as any, minioService as any);
    const buffer = makeMp4();

    await expect(
      service.upload({
        userId: 'user-1',
        folderId: 'foreign-folder',
        fileType: 'image',
        file: uploadFile(buffer),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.folder.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign-folder', userId: 'user-1' },
    });
    expect(minioService.uploadFile).not.toHaveBeenCalled();
    expect(minioService.deleteFile).not.toHaveBeenCalled();
    expect(prisma.file.create).not.toHaveBeenCalled();
  });

  it.each([
    ['spoofed bytes', uploadFile(Buffer.from('%PDF-1.7'))],
    ['oversized bytes', uploadFile(Buffer.alloc(MAX_UPLOAD_SIZE_BYTES + 1, 0x61), { size: 1 })],
    ['unsafe filename', uploadFile(makeMp4(), { originalname: '../flight.mp4' })],
  ])('rejects %s before any Prisma or MinIO call', async (_case, file) => {
    const { prisma, minioService } = dependencies();
    const service = new FileService(prisma as any, minioService as any);

    await expect(
      service.upload({
        userId: 'user-1',
        folderId: 'owned-folder',
        fileType: 'image',
        file,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.folder.findFirst).not.toHaveBeenCalled();
    expect(prisma.folder.create).not.toHaveBeenCalled();
    expect(prisma.file.create).not.toHaveBeenCalled();
    expect(minioService.uploadFile).not.toHaveBeenCalled();
    expect(minioService.deleteFile).not.toHaveBeenCalled();
  });

  it('derives the namespace and persists validated metadata instead of caller values', async () => {
    const { prisma, minioService } = dependencies();
    const service = new FileService(prisma as any, minioService as any);
    const buffer = makeMp4();
    const fingerprint = `sha256:${createHash('sha256').update(buffer).digest('hex')}`;

    await service.upload({
      userId: 'user-1',
      folderId: 'owned-folder',
      fileType: 'image',
      file: uploadFile(buffer, { size: 1 }),
    });

    const storageFileName = minioService.uploadFile.mock.calls[0][0].file_name;
    expect(storageFileName).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-flight\.mp4$/,
    );
    expect(minioService.uploadFile).toHaveBeenCalledWith(
      {
        folder: 'owner@example.com',
        file_type: 'video',
        file_name: storageFileName,
      },
      buffer,
    );
    expect(prisma.file.create).toHaveBeenCalledWith({
      data: {
        name: 'flight.mp4',
        oldName: 'flight.mp4',
        folderId: 'owned-folder',
        src: `owner@example.com/video/${storageFileName}`,
        type: 'video',
        size: buffer.length,
        mimeType: 'video/mp4',
        fingerprint,
        userId: 'user-1',
        tags: [],
      },
    });
    expect(fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('uses independent object keys when the same filename is uploaded twice', async () => {
    const { prisma, minioService } = dependencies();
    const service = new FileService(prisma as any, minioService as any);

    await service.upload({
      userId: 'user-1',
      folderId: 'owned-folder',
      file: uploadFile(makeMp4()),
    });
    await service.upload({
      userId: 'user-1',
      folderId: 'owned-folder',
      file: uploadFile(makeMp4()),
    });

    const objectNames = minioService.uploadFile.mock.calls.map(
      ([body]) => `${body.folder}/${body.file_type}/${body.file_name}`,
    );
    expect(new Set(objectNames).size).toBe(2);
    expect(prisma.file.create.mock.calls.map(([call]) => call.data.src)).toEqual(objectNames);
  });

  it('removes the newly uploaded object when Prisma persistence fails', async () => {
    const { prisma, minioService } = dependencies();
    const databaseError = new Error('database unavailable');
    prisma.file.create.mockRejectedValue(databaseError);
    const service = new FileService(prisma as any, minioService as any);

    await expect(
      service.upload({
        userId: 'user-1',
        folderId: 'owned-folder',
        file: uploadFile(makeMp4()),
      }),
    ).rejects.toBe(databaseError);

    const body = minioService.uploadFile.mock.calls[0][0];
    expect(minioService.deleteFile).toHaveBeenCalledWith({
      folder: body.folder,
      file_type: body.file_type,
      file_name: body.file_name,
    });
  });

  it('reports both persistence and cleanup failures', async () => {
    const { prisma, minioService } = dependencies();
    const databaseError = new Error('database unavailable');
    const cleanupError = new Error('cleanup unavailable');
    prisma.file.create.mockRejectedValue(databaseError);
    minioService.deleteFile.mockRejectedValue(cleanupError);
    const service = new FileService(prisma as any, minioService as any);

    await expect(
      service.upload({
        userId: 'user-1',
        folderId: 'owned-folder',
        file: uploadFile(makeMp4()),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        errors: [databaseError, cleanupError],
      }),
    );
  });
});
