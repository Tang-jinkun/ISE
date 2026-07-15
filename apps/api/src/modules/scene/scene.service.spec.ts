import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateSceneDto } from './dto/create-scene.dto';
import { SceneService } from './scene.service';

jest.mock('@ise/runtime-contracts', () => {
  return jest.requireActual('../../../../../packages/runtime-contracts/src/scene.ts');
});

jest.mock('@/prisma/prisma.service', () => ({ PrismaService: class PrismaService {} }), {
  virtual: true,
});

const validConfig = {
  schemaVersion: 'ise-scene/v1',
  sourceDocumentId: 'file-1',
  eventPlanArtifactId: 'event-plan-1',
  runtimePlanArtifactId: 'runtime-plan-1',
  totalDurationMs: 180_000,
  entities: [],
  tracks: [],
  diagnostics: [],
};

describe('SceneService config validation', () => {
  const prisma = {
    scene: {
      create: jest.fn().mockResolvedValue({ id: 'scene-1' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'scene-1' }),
      update: jest.fn().mockResolvedValue({ id: 'scene-1' }),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists a validated SceneProjectConfig object on create', async () => {
    const service = new SceneService(prisma as any);

    await service.create('user-1', { title: 'Replay', config: validConfig });

    expect(prisma.scene.create).toHaveBeenCalledWith({
      data: { title: 'Replay', config: validConfig, userId: 'user-1' },
    });
  });

  it.each([
    [
      'create',
      (service: SceneService) => service.create('user-1', { title: 'Replay', config: [] }),
    ],
    [
      'update',
      (service: SceneService) => service.update('user-1', 'scene-1', { config: { bad: true } }),
    ],
  ])('rejects an invalid config on %s before persistence', async (_case, action) => {
    const service = new SceneService(prisma as any);

    await expect(action(service)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.scene.create).not.toHaveBeenCalled();
    expect(prisma.scene.update).not.toHaveBeenCalled();
  });

  it('rejects unknown create fields through the strict global pipe contract', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });

    await expect(
      pipe.transform(
        { title: 'Replay', config: validConfig, userId: 'attacker' },
        { type: 'body', metatype: CreateSceneDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
