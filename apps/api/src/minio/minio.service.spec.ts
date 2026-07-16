import * as Minio from 'minio';
import { Readable } from 'stream';
import { MinioService } from './minio.service';

jest.mock('minio', () => ({ Client: jest.fn() }));

const clientConstructor = Minio.Client as unknown as jest.Mock;

describe('MinioService endpoint selection', () => {
  const environmentNames = [
    'MINIO_ENDPOINT',
    'MINIO_PORT',
    'MINIO_PUBLIC_ENDPOINT',
    'MINIO_PUBLIC_PORT',
    'MINIO_ACCESS_KEY',
    'MINIO_SECRET_KEY',
    'MINIO_BUCKET',
  ] as const;
  const previousEnvironment = new Map<string, string | undefined>();

  beforeEach(() => {
    jest.clearAllMocks();
    for (const name of environmentNames) {
      previousEnvironment.set(name, process.env[name]);
    }
    Object.assign(process.env, {
      MINIO_ENDPOINT: 'minio',
      MINIO_PORT: '9000',
      MINIO_PUBLIC_ENDPOINT: '127.0.0.1',
      MINIO_PUBLIC_PORT: '19000',
      MINIO_ACCESS_KEY: 'unit-access-key',
      MINIO_SECRET_KEY: 'unit-secret-key',
      MINIO_BUCKET: 'ise',
    });
  });

  afterEach(() => {
    for (const name of environmentNames) {
      const value = previousEnvironment.get(name);
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    previousEnvironment.clear();
  });

  it('uses the internal client for bucket access and the public client for signed URLs', async () => {
    const internalClient = {
      bucketExists: jest.fn().mockResolvedValue(true),
      getObject: jest.fn().mockResolvedValue(Readable.from('data')),
      presignedGetObject: jest.fn(),
    };
    const publicClient = {
      presignedGetObject: jest
        .fn()
        .mockResolvedValue('http://127.0.0.1:19000/ise/demo/model.glb?signature=test'),
    };
    clientConstructor
      .mockImplementationOnce(() => internalClient)
      .mockImplementationOnce(() => publicClient);

    const service = new MinioService();
    const url = await service.presignRead('demo/model.glb', 300);
    await service.openRead('demo/model.glb');

    expect(clientConstructor).toHaveBeenNthCalledWith(1, {
      endPoint: 'minio',
      port: 9000,
      useSSL: false,
      accessKey: 'unit-access-key',
      secretKey: 'unit-secret-key',
    });
    expect(clientConstructor).toHaveBeenNthCalledWith(2, {
      endPoint: '127.0.0.1',
      port: 19000,
      useSSL: false,
      accessKey: 'unit-access-key',
      secretKey: 'unit-secret-key',
    });
    expect(internalClient.bucketExists).toHaveBeenCalledWith('ise');
    expect(internalClient.getObject).toHaveBeenCalledWith('ise', 'demo/model.glb');
    expect(internalClient.presignedGetObject).not.toHaveBeenCalled();
    expect(publicClient.presignedGetObject).toHaveBeenCalledWith(
      'ise',
      'demo/model.glb',
      300,
    );
    expect(url).toBe('http://127.0.0.1:19000/ise/demo/model.glb?signature=test');
  });
});
