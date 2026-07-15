import { PassThrough, Readable } from 'stream';
import { setImmediate as waitForImmediate } from 'timers/promises';

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
  function createResponse() {
    const response = new PassThrough() as PassThrough & { setHeader: jest.Mock };
    response.setHeader = jest.fn();
    response.on('error', () => undefined);
    return response;
  }

  async function createController(readOwned: jest.Mock) {
    jest.resetModules();
    jest.doMock('@/utils', () => ({ responseMessage: jest.fn() }), { virtual: true });
    const { FileController } = await import('./file.controller');
    return new FileController({ readOwned } as any);
  }

  it('streams owner-scoped bytes with trusted metadata headers', async () => {
    const stream = Readable.from(Buffer.from('flight'));
    const readOwned = jest.fn().mockResolvedValue({
      stream,
      name: "O'Brien() flight*.docx",
      size: 42,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fingerprint: `sha256:${'a'.repeat(64)}`,
    });
    const response = createResponse();
    const received: Buffer[] = [];
    response.on('data', (chunk) => received.push(Buffer.from(chunk)));
    const controller = await createController(readOwned);

    await controller.content('file-1', { user: { sub: 'user-1' } } as any, response as any);

    expect(readOwned).toHaveBeenCalledWith('user-1', 'file-1');
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(response.setHeader).toHaveBeenCalledWith('Content-Length', '42');
    expect(response.setHeader).toHaveBeenCalledWith('X-Content-SHA256', `sha256:${'a'.repeat(64)}`);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      "attachment; filename*=UTF-8''O%27Brien%28%29%20flight%2A.docx",
    );
    expect(Buffer.concat(received).toString()).toBe('flight');
    expect(response.writableEnded).toBe(true);
  });

  it('never places control characters directly in Content-Disposition', async () => {
    const readOwned = jest.fn().mockResolvedValue({
      stream: Readable.from(Buffer.from('flight')),
      name: 'report\r\nX-Injected: true.docx',
      size: 6,
      mimeType: 'application/octet-stream',
      fingerprint: null,
    });
    const response = createResponse();
    response.resume();
    const controller = await createController(readOwned);

    await controller.content('file-1', { user: { sub: 'user-1' } } as any, response as any);

    const disposition = response.setHeader.mock.calls.find(
      ([name]) => name === 'Content-Disposition',
    )?.[1] as string;
    expect(disposition).toBe("attachment; filename*=UTF-8''report%0D%0AX-Injected%3A%20true.docx");
    expect(disposition).not.toMatch(/[\r\n]/);
  });

  it('lets Nest handle a read failure before setting response headers', async () => {
    const failure = new Error('MinIO unavailable');
    const controller = await createController(jest.fn().mockRejectedValue(failure));
    const response = createResponse();

    await expect(
      controller.content('file-1', { user: { sub: 'user-1' } } as any, response as any),
    ).rejects.toBe(failure);
    expect(response.setHeader).not.toHaveBeenCalled();
    expect(response.destroyed).toBe(false);
  });

  it('handles a source failure and destroys the response without an unhandled error', async () => {
    const stream = new PassThrough();
    const readOwned = jest.fn().mockResolvedValue({
      stream,
      name: 'flight.mp4',
      size: 20,
      mimeType: 'video/mp4',
      fingerprint: null,
    });
    const response = createResponse();
    const controller = await createController(readOwned);
    const unhandled: unknown[] = [];
    const onUncaught = (error: unknown) => unhandled.push(error);
    const onRejection = (error: unknown) => unhandled.push(error);
    process.on('uncaughtExceptionMonitor', onUncaught);
    process.on('unhandledRejection', onRejection);

    const content = controller.content(
      'file-1',
      { user: { sub: 'user-1' } } as any,
      response as any,
    );
    try {
      await waitForImmediate();
      expect(stream.listenerCount('error')).toBeGreaterThan(0);
      stream.destroy(new Error('source failed'));
      await expect(content).resolves.toBeUndefined();
      await waitForImmediate();
      expect(response.destroyed).toBe(true);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('uncaughtExceptionMonitor', onUncaught);
      process.off('unhandledRejection', onRejection);
      stream.destroy();
      response.destroy();
    }
  });

  it('destroys the source when the client aborts', async () => {
    const stream = new PassThrough();
    const readOwned = jest.fn().mockResolvedValue({
      stream,
      name: 'flight.mp4',
      size: 20,
      mimeType: 'video/mp4',
      fingerprint: null,
    });
    const response = createResponse();
    const controller = await createController(readOwned);

    const content = controller.content(
      'file-1',
      { user: { sub: 'user-1' } } as any,
      response as any,
    );
    try {
      await waitForImmediate();
      response.destroy(new Error('client aborted'));
      await expect(content).resolves.toBeUndefined();
      expect(stream.destroyed).toBe(true);
    } finally {
      stream.destroy();
      response.destroy();
    }
  });
});
