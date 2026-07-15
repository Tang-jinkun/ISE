import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WinstonModule } from 'nest-winston';
import winstonLogger from './config/winston.config';
import { AllExceptionsFilter } from './filter/all-exception.filter';
import { HttpExceptionsFilter } from './filter/http-exception.filter';
import { MinioModule } from './minio/minio.module';
import { EmailModule } from './modules/email/email.module';
import { AuthModule } from './modules/auth/auth.module';
import { FileModule } from './modules/file/file.module';
import { FolderModule } from './modules/folder/folder.module';
import { SceneModule } from './modules/scene/scene.module';
import { ScriptModule } from './modules/script/script.module';

@Module({
  imports: [
    MinioModule,
    EmailModule,
    AuthModule,
    FileModule,
    FolderModule,
    SceneModule,
    ScriptModule,
    WinstonModule.forRoot({
      transports: winstonLogger.transports,
      format: winstonLogger.format,
      defaultMeta: winstonLogger.defaultMeta,
      exitOnError: false, // 防止意外退出
    }),
  ],
  controllers: [AppController],
  providers: [AppService, AllExceptionsFilter, HttpExceptionsFilter],
})
export class AppModule {}
