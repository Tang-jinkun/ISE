import { Module } from '@nestjs/common';
import { ScriptService } from './script.service';
import { ScriptController } from './script.controller';
import { PrismaService } from '@/prisma/prisma.service';

@Module({
  controllers: [ScriptController],
  providers: [ScriptService, PrismaService],
})
export class ScriptModule {}
