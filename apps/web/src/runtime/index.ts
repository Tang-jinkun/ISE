import { SceneRuntimeImpl } from './SceneRuntime';
import type { SceneRuntime, SceneRuntimeOptions } from './types';

export type { SceneRuntime, SceneRuntimeOptions } from './types';

export function createSceneRuntime(options: SceneRuntimeOptions): SceneRuntime {
  return new SceneRuntimeImpl(options);
}
