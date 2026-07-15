import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import { MinioService } from './minio.service';
import { SaveMinioFile } from './dto/save_minio.dto';
import { responseMessage } from '@/utils';

@Controller('minio')
export class MinioController {
  constructor(private readonly minioService: MinioService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage: multer.memoryStorage() }))
  async uploadFile(@UploadedFile() file: any, @Body() body: SaveMinioFile) {
    return await this.minioService.uploadFile(body, file.buffer);
  }

  @Post('read')
  async read(@Body() { objectName }: { objectName: string }) {
    const data = await this.minioService.read(objectName);
    return responseMessage(data);
  }

  @Get()
  async downloadZIP(
    @Query('target') target: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { zipStream, zipName } = await this.minioService.createZipFromTarget(target);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipName}"`,
    });
    return new StreamableFile(zipStream);
  }
}
