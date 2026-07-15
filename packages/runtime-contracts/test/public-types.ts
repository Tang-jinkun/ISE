import type {
  AssetManifestEntry,
  AssetSeedManifest,
  Diagnostic,
  ResolvedAssetAccess,
  SceneProjectConfig,
  SceneTrack,
  SceneTrackItem
} from '../src/index.js';

export type PublicContractTypeSurface = {
  assetManifestEntry: AssetManifestEntry;
  assetSeedManifest: AssetSeedManifest;
  diagnostic: Diagnostic;
  resolvedAssetAccess: ResolvedAssetAccess;
  sceneProjectConfig: SceneProjectConfig;
  sceneTrack: SceneTrack;
  sceneTrackItem: SceneTrackItem;
};
