import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import { Request, Response } from 'express';
import { IsOptional, IsString } from 'class-validator';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { FileService } from './file.service';
import { responseMessage } from '@/utils';
import { UpdateFileDto } from './dto/update-file.dto';
import { MAX_UPLOAD_SIZE_BYTES } from './upload-validation';

class UploadFileDto {
  @IsOptional()
  @IsString()
  folderId?: string;

  @IsOptional()
  @IsString()
  fileType?: string;
}

class ListFilesQueryDto {
  @IsOptional()
  @IsString()
  folderId?: string;

  @IsOptional()
  @IsString()
  fileType?: string;
}

@ApiTags('文件管理')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
@ApiHeader({
  name: 'Authorization',
  required: true,
  description: 'Bearer access_token',
})
@Controller('file')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Post('upload')
  @ApiOperation({ summary: '上传文件并保存到 MinIO 与数据库' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        folderId: { type: 'string', nullable: true },
        fileType: {
          type: 'string',
          description:
            'Legacy field accepted for compatibility; storage type is derived by the server',
          nullable: true,
        },
        file: {
          type: 'string',
          format: 'binary',
        },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadFileDto,
    @Req() req: Request & { user?: any },
  ) {
    const payload = req.user;
    const data = await this.fileService.upload({
      userId: payload.sub,
      folderId: body.folderId,
      file,
      fileType: body.fileType,
    });
    return responseMessage(data, '上传成功');
  }

  @Get('list')
  @ApiOperation({ summary: '获取当前用户的文件列表' })
  @ApiQuery({ name: 'folderId', required: false })
  @ApiQuery({
    name: 'fileType',
    required: false,
    description: '文件类型：image、video、audio、geojson 等',
  })
  async list(@Query() query: ListFilesQueryDto, @Req() req: Request & { user?: any }) {
    const payload = req.user;
    const data = await this.fileService.list({
      userId: payload.sub,
      folderId: query.folderId,
      fileType: query.fileType,
    });
    return responseMessage(data, '获取成功');
  }

  @Get(':id/content')
  async content(
    @Param('id') id: string,
    @Req() req: Request & { user?: any },
    @Res() res: Response,
  ) {
    const file = await this.fileService.readOwned(req.user.sub, id);
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', String(file.size));
    if (file.fingerprint) {
      res.setHeader('X-Content-SHA256', file.fingerprint);
    }
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    file.stream.pipe(res);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新文件信息' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateFileDto,
    @Req() req: Request & { user?: any },
  ) {
    const payload = req.user;
    const data = await this.fileService.update(payload.sub, id, body);
    return responseMessage(data, '更新成功');
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除文件（同时删除 MinIO 与数据库记录）' })
  async remove(@Param('id') id: string, @Req() req: Request & { user?: any }) {
    const payload = req.user;
    const data = await this.fileService.remove(payload.sub, id);
    return responseMessage(data, '删除成功');
  }
}
