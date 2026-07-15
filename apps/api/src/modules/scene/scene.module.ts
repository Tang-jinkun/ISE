import { Module } from '@nestjs/common';
import { SceneService } from './scene.service';
import { SceneController } from './scene.controller';
import { PrismaService } from '@/prisma/prisma.service';

@Module({
  controllers: [SceneController],
  providers: [SceneService, PrismaService],
})
export class SceneModule {}
