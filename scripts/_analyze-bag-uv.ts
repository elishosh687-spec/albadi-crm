import * as fs from "fs";
import * as path from "path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { prepareBagMesh } from "../lib/configurator/prepare-bag-mesh";
import { computeBagUvRegions } from "../lib/configurator/bag-uv-regions";

const draco = new DRACOLoader();
draco.setDecoderPath(
  pathToFileURL(
    path.join(process.cwd(), "node_modules/three/examples/jsm/libs/draco/")
  ).href
);

async function analyze(file: string) {
  const buf = fs.readFileSync(file);
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const gltf = await loader.parseAsync(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    ""
  );
  const prepared = prepareBagMesh(gltf.scene);
  if (!prepared) return;
  const geo = prepared.geometry;
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  const regions = computeBagUvRegions(geo);

  console.log("\n===", file.split("/").pop(), "===");
  console.log("regions", JSON.stringify(regions, null, 2));

  let minU = Infinity,
    maxU = -Infinity,
    minV = Infinity,
    maxV = -Infinity;
  let outside01 = 0;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
    if (u < 0 || u > 1 || v < 0 || v > 1) outside01++;
  }
  console.log("all UV bounds", { minU, maxU, minV, maxV });
  console.log("outside 0-1:", outside01, "/", uv.count);

  const hist = new Map<string, number>();
  for (let i = 0; i < uv.count; i++) {
    const key = `${uv.getX(i).toFixed(3)},${uv.getY(i).toFixed(3)}`;
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  console.log("unique UV (3dp):", hist.size);
}

async function main() {
  for (const f of [
    "public/Reusable_Bag_Large_v002.glb",
    "public/Reusable_Bag_Medium.glb",
    "public/Reusable_Bag_Small.glb",
  ]) {
    await analyze(f);
  }
  draco.dispose();
}

main().catch(console.error);
