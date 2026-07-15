import { NotFoundException } from '@nestjs/common';
import { FolderService } from './folder.service';

jest.mock('@/prisma/prisma.service', () => ({ PrismaService: class PrismaService {} }), {
  virtual: true,
});

describe('FolderService parent authorization', () => {
  it('rejects a parent folder not owned by the creating user', async () => {
    const prisma = {
      folder: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'foreign-parent',
          userId: 'other-user',
        }),
      },
    };
    const service = new FolderService(prisma as any);

    await expect(
      service.create('user-1', { name: 'private child', parentId: 'foreign-parent' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.folder.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign-parent', userId: 'user-1' },
    });
    expect(prisma.folder.create).not.toHaveBeenCalled();
  });
});
