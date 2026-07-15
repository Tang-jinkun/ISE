import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailModule } from '@/modules/email/email.module';
import { RedisService } from '@/redis/redis.service';
import { requiredEnv } from '@/config/required-env';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    JwtModule.register({
      secret: requiredEnv('JWT_SECRET'),
      signOptions: { expiresIn: '3d' },
    }),
    EmailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, PrismaService, RedisService],
  exports: [AuthService],
})
export class AuthModule {}
