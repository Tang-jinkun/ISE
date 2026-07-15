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

describe('FileController content boundary', () => {
  it('streams owner-scoped bytes with trusted metadata headers', async () => {
    jest.resetModules();
    jest.doMock('@/utils', () => ({ responseMessage: jest.fn() }), { virtual: true });
    const { FileController } = await import('./file.controller');
    const stream = { pipe: jest.fn() };
    const fileService = {
      readOwned: jest.fn().mockResolvedValue({
        stream,
        name: 'flight plan.docx',
        size: 42,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fingerprint: `sha256:${'a'.repeat(64)}`,
      }),
    };
    const response = { setHeader: jest.fn() };
    const controller = new FileController(fileService as any);

    await controller.content('file-1', { user: { sub: 'user-1' } } as any, response as any);

    expect(fileService.readOwned).toHaveBeenCalledWith('user-1', 'file-1');
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(response.setHeader).toHaveBeenCalledWith('Content-Length', '42');
    expect(response.setHeader).toHaveBeenCalledWith('X-Content-SHA256', `sha256:${'a'.repeat(64)}`);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      "attachment; filename*=UTF-8''flight%20plan.docx",
    );
    expect(stream.pipe).toHaveBeenCalledWith(response);
  });
});
