type BootstrapApp = {
  enableCors: jest.Mock;
  get: jest.Mock;
  listen: jest.Mock;
  use: jest.Mock;
  useGlobalFilters: jest.Mock;
  useGlobalPipes: jest.Mock;
  useLogger: jest.Mock;
  useStaticAssets: jest.Mock;
};

type BootstrapHarness = {
  app: BootstrapApp;
  createDocument: jest.Mock;
  document: object;
  expectedListenTarget: string | number;
  requestMiddleware: jest.Mock;
  setup: jest.Mock;
};

async function runBootstrap(disableSwagger: string | undefined): Promise<BootstrapHarness> {
  const previousDisableSwagger = process.env.DISABLE_SWAGGER;
  if (disableSwagger === undefined) {
    delete process.env.DISABLE_SWAGGER;
  } else {
    process.env.DISABLE_SWAGGER = disableSwagger;
  }

  jest.resetModules();

  const app: BootstrapApp = {
    enableCors: jest.fn(),
    get: jest.fn((token: unknown) => ({ token })),
    listen: jest.fn().mockResolvedValue(undefined),
    use: jest.fn(),
    useGlobalFilters: jest.fn(),
    useGlobalPipes: jest.fn(),
    useLogger: jest.fn(),
    useStaticAssets: jest.fn(),
  };
  const create = jest.fn().mockResolvedValue(app);
  const document = {};
  const createDocument = jest.fn().mockReturnValue(document);
  const setup = jest.fn();
  const requestMiddleware = jest.fn();
  const expectedListenTarget = process.env.PORT || 3000;

  jest.doMock('@nestjs/core', () => ({
    ...jest.requireActual('@nestjs/core'),
    NestFactory: { create },
  }));
  jest.doMock('@nestjs/swagger', () => ({
    ...jest.requireActual('@nestjs/swagger'),
    SwaggerModule: { createDocument, setup },
  }));
  jest.doMock('./app.module', () => ({ AppModule: class AppModule {} }));
  jest.doMock('@/utils/common', () => ({ requestMiddleware }), { virtual: true });
  jest.doMock('@/utils', () => ({ responseMessage: jest.fn() }), { virtual: true });

  try {
    await import('./main');
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    if (previousDisableSwagger === undefined) {
      delete process.env.DISABLE_SWAGGER;
    } else {
      process.env.DISABLE_SWAGGER = previousDisableSwagger;
    }
  }

  return {
    app,
    createDocument,
    document,
    expectedListenTarget,
    requestMiddleware,
    setup,
  };
}

describe('API bootstrap', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('enables Swagger when DISABLE_SWAGGER is unset', async () => {
    const { app, createDocument, document, setup } = await runBootstrap(undefined);

    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(createDocument).toHaveBeenCalledWith(app, expect.any(Object));
    expect(setup).toHaveBeenCalledTimes(1);
    expect(setup).toHaveBeenCalledWith('docs', app, document);
  });

  it.each(['TRUE', 'false'])(
    'keeps Swagger enabled when DISABLE_SWAGGER is the near-miss value %s',
    async (disableSwagger) => {
      const { app, createDocument, document, setup } = await runBootstrap(disableSwagger);

      expect(createDocument).toHaveBeenCalledTimes(1);
      expect(setup).toHaveBeenCalledWith('docs', app, document);
    },
  );

  it('skips Swagger only for true and continues the remaining bootstrap stages', async () => {
    const {
      app,
      createDocument,
      expectedListenTarget,
      requestMiddleware,
      setup,
    } = await runBootstrap('true');

    expect(createDocument).not.toHaveBeenCalled();
    expect(setup).not.toHaveBeenCalled();
    expect(app.useLogger).toHaveBeenCalledTimes(1);
    expect(app.use).toHaveBeenCalledWith(requestMiddleware);
    expect(app.useGlobalPipes).toHaveBeenCalledTimes(1);
    expect(app.useGlobalFilters).toHaveBeenCalledTimes(1);
    expect(app.useStaticAssets).toHaveBeenCalledTimes(1);
    expect(app.enableCors).toHaveBeenCalledWith({
      origin: '*',
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    });
    expect(app.listen).toHaveBeenCalledWith(expectedListenTarget);

    const { BadRequestException, ValidationPipe } = await import('@nestjs/common');
    const { CreateFolderDto } = await import('./modules/folder/dto/create-folder.dto');
    const pipe = app.useGlobalPipes.mock.calls[0]?.[0];
    expect(pipe).toBeInstanceOf(ValidationPipe);

    const metadata = { type: 'body' as const, metatype: CreateFolderDto };
    const transformed = await pipe.transform({ name: 'owned folder' }, metadata);
    expect(transformed).toBeInstanceOf(CreateFolderDto);
    await expect(
      pipe.transform({ name: 'owned folder', userId: 'attacker-controlled' }, metadata),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
