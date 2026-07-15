import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateSceneDto } from './dto/create-scene.dto';
import { SceneController } from './scene.controller';
import { SceneService } from './scene.service';

jest.mock('@ise/runtime-contracts', () => {
  return jest.requireActual('../../../../../packages/runtime-contracts/src/scene.ts');
});
jest.mock('@/prisma/prisma.service', () => ({ PrismaService: class PrismaService {} }), {
  virtual: true,
});
jest.mock('@/utils', () => ({ responseMessage: jest.fn((data: unknown) => ({ data })) }), {
  virtual: true,
});

const validSceneConfig = {
  schemaVersion: 'ise-scene/v1',
  sourceDocumentId: 'file-1',
  eventPlanArtifactId: 'event-plan-1',
  runtimePlanArtifactId: 'runtime-plan-1',
  totalDurationMs: 180_000,
  entities: [],
  tracks: [],
  diagnostics: [],
};

describe('SceneController request validation', () => {
  const prisma = {
    scene: {
      create: jest.fn().mockResolvedValue({ id: 'scene-1' }),
    },
  };
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function create(body: object) {
    const dto = await pipe.transform(body, { type: 'body', metatype: CreateSceneDto });
    const controller = new SceneController(new SceneService(prisma as any));
    return controller.create(dto, { user: { sub: 'user-1' } } as any);
  }

  it('returns 400 for unknown request fields', async () => {
    const error = await create({
      title: 'Replay',
      config: validSceneConfig,
      userId: 'attacker',
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getStatus()).toBe(400);
    expect(prisma.scene.create).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid ise-scene/v2 config', async () => {
    const error = await create({
      title: 'Replay',
      config: { ...validSceneConfig, schemaVersion: 'ise-scene/v2' },
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getStatus()).toBe(400);
    expect(prisma.scene.create).not.toHaveBeenCalled();
  });

  it('accepts a title with a valid SceneProjectConfig', async () => {
    await expect(create({ title: 'Replay', config: validSceneConfig })).resolves.toEqual({
      data: { id: 'scene-1' },
    });
    expect(prisma.scene.create).toHaveBeenCalledWith({
      data: { title: 'Replay', config: validSceneConfig, userId: 'user-1' },
    });
  });
});
