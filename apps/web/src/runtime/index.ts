import { SceneRuntimeImpl } from './SceneRuntime';
import type { SceneRuntime, SceneRuntimeOptions } from './types';

export type { SceneRuntime, SceneRuntimeOptions } from './types';
export {
  RUNTIME_CATALOG_ASSET_IDS,
  RUNTIME_CATALOG_CONFIG,
  RUNTIME_MAIN_CONFIG,
} from './testing/runtimeFixtures';

export function createSceneRuntime(options: SceneRuntimeOptions): SceneRuntime {
  return new SceneRuntimeImpl(options);
}
