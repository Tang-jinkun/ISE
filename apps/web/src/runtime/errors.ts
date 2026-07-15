export type SceneRuntimeErrorCode =
  | 'RUNTIME_DISPOSED'
  | 'RUNTIME_NOT_LOADED'
  | 'ASSET_ACCESS_EXPIRED'
  | 'ASSET_FETCH_FAILED'
  | 'ASSET_METADATA_INVALID'
  | 'GLB_INVALID'
  | 'TRAJECTORY_INVALID'
  | 'GEOJSON_INVALID'
  | 'MODEL_COMMAND_INVALID'
  | 'MEDIA_AUTOPLAY_BLOCKED'
  | 'MEDIA_DECODE_FAILED';

export class SceneRuntimeError extends Error {
  constructor(
    readonly code: SceneRuntimeErrorCode,
    message: string,
    readonly assetId?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SceneRuntimeError';
  }
}
