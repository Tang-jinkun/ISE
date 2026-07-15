import { Controller, Get, Param, UseGuards } from '@nestjs/common';
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
}
