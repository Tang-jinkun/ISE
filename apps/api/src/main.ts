import 'reflect-metadata';
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import * as path from 'path';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './filter/all-exception.filter';
import { HttpExceptionsFilter } from './filter/http-exception.filter';
import { requestMiddleware } from '@/utils/common';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '2mb' });

  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  app.use(requestMiddleware);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(app.get(HttpExceptionsFilter), app.get(AllExceptionsFilter));

  app.useStaticAssets(path.join(__dirname, '..', '..', 'raster_uploads'));

  if (process.env.DISABLE_SWAGGER !== 'true') {
    const options = new DocumentBuilder()
      .setTitle('装备任务场景平台API文档')
      .setDescription('Background system based on Nest.js + Vue3 full stack development')
      .setVersion('1.0')
      .build();
    const document = SwaggerModule.createDocument(app, options);
    SwaggerModule.setup('docs', app, document);
  }

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  });
  await app.listen(process.env.PORT || 3000);
}
bootstrap();
