describe('FileController upload boundary', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('@/utils', () => ({ responseMessage: jest.fn() }), { virtual: true });
    jest.doMock('@/prisma/prisma.service', () => ({ PrismaService: class PrismaService {} }), {
      virtual: true,
    });
    jest.doMock('@/minio/minio.service', () => ({ MinioService: class MinioService {} }), {
      virtual: true,
    });
  });

  it('configures Multer to reject files larger than 26_214_400 bytes', async () => {
    const memoryStorage = jest.fn(() => ({ engine: 'memory' }));
    const fileInterceptor = jest.fn(() => class UploadInterceptor {});
    jest.doMock('multer', () => ({ memoryStorage }));
    jest.doMock('@nestjs/platform-express', () => ({ FileInterceptor: fileInterceptor }));

    await import('./file.controller');

    expect(fileInterceptor).toHaveBeenCalledWith('file', {
      storage: { engine: 'memory' },
      limits: { fileSize: 26_214_400 },
    });
  });
});
