import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { CreateFolderDto } from './modules/folder/dto/create-folder.dto';

describe('bootstrap request validation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('installs a transforming strict-whitelist ValidationPipe globally', async () => {
    const app = {
      enableCors: jest.fn(),
      get: jest.fn().mockReturnValue({}),
      listen: jest.fn().mockResolvedValue(undefined),
      use: jest.fn(),
      useGlobalFilters: jest.fn(),
      useGlobalPipes: jest.fn(),
      useLogger: jest.fn(),
      useStaticAssets: jest.fn(),
    };

    jest.spyOn(NestFactory, 'create').mockResolvedValue(app as any);
    jest.spyOn(SwaggerModule, 'createDocument').mockReturnValue({} as any);
    jest.spyOn(SwaggerModule, 'setup').mockImplementation(() => undefined);
    jest.doMock('./app.module', () => ({ AppModule: class AppModule {} }));
    jest.doMock('@/utils/common', () => ({ requestMiddleware: jest.fn() }), {
      virtual: true,
    });
    jest.doMock('@/utils', () => ({ responseMessage: jest.fn() }), { virtual: true });

    await import('./main');
    await new Promise((resolve) => setImmediate(resolve));

    expect(app.useGlobalPipes).toHaveBeenCalledTimes(1);
    const pipe = app.useGlobalPipes.mock.calls[0]?.[0];
    expect(pipe).toBeInstanceOf(ValidationPipe);

    const metadata = { type: 'body' as const, metatype: CreateFolderDto };
    const transformed = await pipe.transform({ name: 'owned folder' }, metadata);
    expect(transformed).toBeInstanceOf(CreateFolderDto);
    await expect(
      pipe.transform({ name: 'owned folder', userId: 'attacker-controlled' }, metadata),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('skips Swagger creation and setup when DISABLE_SWAGGER is exactly true', async () => {
    const previousDisableSwagger = process.env.DISABLE_SWAGGER;
    process.env.DISABLE_SWAGGER = 'true';
    jest.resetModules();

    const app = {
      enableCors: jest.fn(),
      get: jest.fn().mockReturnValue({}),
      listen: jest.fn().mockResolvedValue(undefined),
      use: jest.fn(),
      useGlobalFilters: jest.fn(),
      useGlobalPipes: jest.fn(),
      useLogger: jest.fn(),
      useStaticAssets: jest.fn(),
    };

    jest.spyOn(NestFactory, 'create').mockResolvedValue(app as any);
    const createDocument = jest.spyOn(SwaggerModule, 'createDocument').mockReturnValue({} as any);
    const setup = jest.spyOn(SwaggerModule, 'setup').mockImplementation(() => undefined);
    jest.doMock('@nestjs/core', () => ({ NestFactory }));
    jest.doMock('@nestjs/swagger', () => ({
      DocumentBuilder: jest.requireActual('@nestjs/swagger').DocumentBuilder,
      SwaggerModule,
    }));
    jest.doMock('./app.module', () => ({ AppModule: class AppModule {} }));
    jest.doMock('@/utils/common', () => ({ requestMiddleware: jest.fn() }), {
      virtual: true,
    });
    jest.doMock('@/utils', () => ({ responseMessage: jest.fn() }), { virtual: true });

    try {
      await import('./main');
      await new Promise((resolve) => setImmediate(resolve));

      expect(createDocument).not.toHaveBeenCalled();
      expect(setup).not.toHaveBeenCalled();
    } finally {
      if (previousDisableSwagger === undefined) {
        delete process.env.DISABLE_SWAGGER;
      } else {
        process.env.DISABLE_SWAGGER = previousDisableSwagger;
      }
    }
  });
});
