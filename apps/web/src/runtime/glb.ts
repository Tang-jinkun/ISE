import * as THREE from 'three';
import { SceneRuntimeError } from './errors';

export function assertGlbHeader(buffer: ArrayBuffer) {
  if (buffer.byteLength < 12) {
    throw new SceneRuntimeError('GLB_INVALID', 'GLB header is shorter than 12 bytes');
  }
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) {
    throw new SceneRuntimeError('GLB_INVALID', 'GLB magic is not glTF');
  }
  if (view.getUint32(4, true) !== 2) {
    throw new SceneRuntimeError('GLB_INVALID', 'GLB version is not 2');
  }
  if (view.getUint32(8, true) !== buffer.byteLength) {
    throw new SceneRuntimeError('GLB_INVALID', 'GLB declared length does not match payload');
  }
}

export function disposeObject3D(root: THREE.Object3D) {
  const disposed = new Set<object>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry && !disposed.has(mesh.geometry)) {
      mesh.geometry.dispose();
      disposed.add(mesh.geometry);
    }
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    materials.forEach((material) => {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture && !disposed.has(value)) {
          value.dispose();
          disposed.add(value);
        }
      }
      if (!disposed.has(material)) {
        material.dispose();
        disposed.add(material);
      }
    });
  });
}
