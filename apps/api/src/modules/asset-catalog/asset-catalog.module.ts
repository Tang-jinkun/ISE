import { Module } from '@nestjs/common';
import { MinioModule } from '@/minio/minio.module';
import { AssetCatalogController } from './asset-catalog.controller';
import { AssetCatalogService } from './asset-catalog.service';

@Module({
  imports: [MinioModule],
  controllers: [AssetCatalogController],
  providers: [AssetCatalogService],
})
export class AssetCatalogModule {}
