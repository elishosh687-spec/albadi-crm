import * as THREE from "three";

export interface PreparedBagMesh {
  geometry: THREE.BufferGeometry;
  normalMap: THREE.Texture | null;
  /** Height after centering (bottom at y = 0). */
  height: number;
  /** Max of width / depth — for decal sizing. */
  footprint: number;
  /** Front face Z in local space (decal anchor). */
  frontZ: number;
}

function findBagMesh(scene: THREE.Object3D): {
  mesh: THREE.Mesh;
  normalMap: THREE.Texture | null;
} | null {
  const meshes: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  const mesh = meshes[0];
  if (!mesh) return null;

  let normalMap: THREE.Texture | null = null;
  const material = mesh.material;
  if (material instanceof THREE.MeshStandardMaterial && material.normalMap) {
    normalMap = material.normalMap;
  }

  return { mesh, normalMap };
}

/**
 * Clone the first mesh from a GLB scene, bake its transform, then center on X/Z
 * and align the bottom to y = 0 so every size sits on the same floor point.
 */
export function prepareBagMesh(scene: THREE.Object3D): PreparedBagMesh | null {
  const found = findBagMesh(scene);
  if (!found) return null;

  const { mesh, normalMap } = found;
  const geometry = mesh.geometry.clone();
  mesh.updateMatrix();
  geometry.applyMatrix4(mesh.matrix);

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return null;

  const center = new THREE.Vector3();
  box.getCenter(center);
  geometry.translate(-center.x, -box.min.y, -center.z);

  geometry.computeBoundingBox();
  const centered = geometry.boundingBox;
  if (!centered) return null;

  const height = centered.max.y - centered.min.y;
  const width = centered.max.x - centered.min.x;
  const depth = centered.max.z - centered.min.z;

  return {
    geometry,
    normalMap,
    height: Math.max(height, 0.001),
    footprint: Math.max(width, depth, 0.001),
    frontZ: centered.max.z,
  };
}
