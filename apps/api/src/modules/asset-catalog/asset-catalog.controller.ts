import { Controller, Get, Param, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { responseMessage } from '@/utils';
import { AssetCatalogService } from './asset-catalog.service';

@ApiTags('Asset catalog')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
@ApiHeader({
  name: 'Authorization',
  required: true,
  description: 'Bearer access_token',
})
@Controller('asset-catalog')
export class AssetCatalogController {
  constructor(private readonly assetCatalogService: AssetCatalogService) {}

  @Get()
  list() {
    return responseMessage(this.assetCatalogService.listPublic());
  }

  @Get(':assetId/access')
  async access(@Param('assetId') assetId: string) {
    return responseMessage(await this.assetCatalogService.createAccess(assetId));
  }

  @Get(':assetId/content')
  async content(
    @Param('assetId') assetId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { entry, stream } = await this.assetCatalogService.openContent(assetId);
    response.setHeader('x-asset-id', entry.assetId);
    response.setHeader('x-content-sha256', entry.fingerprint);
    if (entry.kind === 'trajectory') {
      response.setHeader('x-trajectory-start-ms', String(entry.trajectory.startTimeMs));
      response.setHeader('x-trajectory-end-ms', String(entry.trajectory.endTimeMs));
    }
    return new StreamableFile(stream, { type: entry.mediaType, length: entry.size });
  }
}
