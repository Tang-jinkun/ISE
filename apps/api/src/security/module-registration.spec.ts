import { MODULE_METADATA } from '@nestjs/common/constants';

describe('internal service module exposure', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      MAIL_USER: 'test@example.com',
      MAIL_PASS: 'test-password',
      MAIL_FROM: 'test@example.com',
    };
    jest.resetModules();
    jest.doMock('@/utils', () => ({ responseMessage: jest.fn() }), { virtual: true });
    jest.doMock('@/config/required-env', () => ({ requiredEnv: jest.fn(() => 'test') }), {
      virtual: true,
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('keeps MinIO as an injectable service without exposing raw routes', async () => {
    const [{ MinioModule }, { MinioService }, { MinioController }] = await Promise.all([
      import('../minio/minio.module'),
      import('../minio/minio.service'),
      import('../minio/minio.controller'),
    ]);

    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, MinioModule) ?? [];
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, MinioModule) ?? [];
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, MinioModule) ?? [];

    expect(controllers).not.toContain(MinioController);
    expect(providers).toContain(MinioService);
    expect(exports).toContain(MinioService);
  });

  it('keeps email delivery injectable without exposing a public relay', async () => {
    const [{ EmailModule }, { EmailService }, { EmailController }] = await Promise.all([
      import('../modules/email/email.module'),
      import('../modules/email/email.service'),
      import('../modules/email/email.controller'),
    ]);

    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, EmailModule) ?? [];
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, EmailModule) ?? [];
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, EmailModule) ?? [];

    expect(controllers).not.toContain(EmailController);
    expect(providers).toContain(EmailService);
    expect(exports).toContain(EmailService);
  });
});
