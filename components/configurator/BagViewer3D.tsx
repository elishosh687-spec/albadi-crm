"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, useGLTF } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import {
  ALL_BAG_GLB_PATHS,
  resolveConfiguratorModelPath,
} from "@/lib/configurator/bag-models";
import { BAG_REST_Y, getBagViewerFraming, getDefaultFraming } from "@/lib/configurator/bag-framing";
import { pickVideoMimeType } from "@/lib/configurator/download-mockup";
import { prepareBagMesh } from "@/lib/configurator/prepare-bag-mesh";
import {
  BAG_UV_TEXTURE_SIZE,
  configureBagAlbedoTexture,
  LOGO_POSITION_LIMITS,
  logoPlacementScalars,
  paintBagUvTexture,
  uvPointToLogoState,
} from "@/lib/configurator/bag-uv-texture";
import type { BagUvRegions } from "@/lib/configurator/bag-uv-regions";
import { UvIslandDebugOverlay } from "./UvIslandDebugOverlay";

export type LogoPlacementMode = "drag" | "controls";

export { LOGO_POSITION_LIMITS };

export interface RecordVideoOptions {
  seconds?: number;
  fps?: number;
}

export interface ViewerApi {
  screenshot: () => Promise<string>;
  resetView: () => void;
  recordVideo: (options?: RecordVideoOptions) => Promise<Blob>;
}

export interface UvRegionsResolvedPayload {
  modelPath: string;
  autoRegions: BagUvRegions | null;
  activeRegions: BagUvRegions | null;
  geometry: THREE.BufferGeometry | null;
}

interface BagViewer3DProps {
  productId: string;
  bagColor: string;
  logoUrl?: string | null;
  logoScale: number;
  logoPositionX: number;
  logoPositionY: number;
  logoRotation: number;
  logoPlacementMode?: LogoPlacementMode;
  onLogoPositionChange?: (positionX: number, positionY: number) => void;
  autoRotate: boolean;
  showLogoHint: boolean;
  isCompact?: boolean;
  onApiReady: (api: ViewerApi) => void;
  uvDebug?: boolean;
  /** When uvDebug=1, load this GLB instead of the catalog size model. */
  debugModelPath?: string | null;
  uvDebugDraft?: BagUvRegions | null;
  onUvDebugDraftChange?: (regions: BagUvRegions | null) => void;
  onUvRegionsResolved?: (payload: UvRegionsResolvedPayload) => void;
}

const BACKDROP_COLOR = "#f0e9dc";
const BAG_START_Y = 2.85;
const PEDESTAL_REST_Y = -0.05;
const ENTRANCE_BAG_DELAY_S = 0.18;
const ENTRANCE_BAG_DURATION_S = 1.35;
const ENTRANCE_PEDESTAL_DURATION_S = 0.55;

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

function easeOutBack(t: number) {
  const c1 = 1.35;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function useLogoImage(logoUrl?: string | null) {
  const [logoImage, setLogoImage] = useState<HTMLImageElement | null>(null);
  const [aspectRatio, setAspectRatio] = useState(1);

  useEffect(() => {
    let cancelled = false;

    if (!logoUrl) {
      setLogoImage(null);
      setAspectRatio(1);
      return;
    }

    const image = new Image();
    image.decoding = "async";
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled) return;
      setLogoImage(image);
      setAspectRatio(
        image.naturalWidth && image.naturalHeight
          ? image.naturalWidth / image.naturalHeight
          : 1
      );
    };
    image.onerror = () => {
      if (!cancelled) {
        setLogoImage(null);
        setAspectRatio(1);
      }
    };
    image.src = logoUrl;

    return () => {
      cancelled = true;
    };
  }, [logoUrl]);

  return { logoImage, aspectRatio };
}

function useBagUvAlbedoTexture({
  bagColor,
  logoImage,
  aspectRatio,
  logoScale,
  logoPositionX,
  logoPositionY,
  logoRotation,
  prepared,
}: {
  bagColor: string;
  logoImage: HTMLImageElement | null;
  aspectRatio: number;
  logoScale: number;
  logoPositionX: number;
  logoPositionY: number;
  logoRotation: number;
  prepared: ReturnType<typeof prepareBagMesh>;
}) {
  const { gl } = useThree();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    if (!canvasRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = BAG_UV_TEXTURE_SIZE;
      canvas.height = BAG_UV_TEXTURE_SIZE;
      canvasRef.current = canvas;
    }
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!textureRef.current) {
      const nextTexture = new THREE.CanvasTexture(canvas);
      configureBagAlbedoTexture(nextTexture, gl.capabilities.getMaxAnisotropy());
      textureRef.current = nextTexture;
      setTexture(nextTexture);
    }

    const activeTexture = textureRef.current;
    const regions = prepared?.uvRegions;

    if (!logoImage || !prepared || !regions) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      activeTexture.needsUpdate = true;
      return;
    }

    paintBagUvTexture(ctx, {
      bagColor,
      logoImage,
      footprint: prepared.footprint,
      height: prepared.height,
      logoScale,
      logoPositionX,
      logoPositionY,
      logoRotation,
      aspectRatio,
      frontRegion: regions.front,
      backRegion: regions.back,
    });
    activeTexture.needsUpdate = true;
  }, [
    aspectRatio,
    bagColor,
    gl,
    logoImage,
    logoPositionX,
    logoPositionY,
    logoRotation,
    logoScale,
    prepared,
  ]);

  useEffect(() => {
    return () => {
      textureRef.current?.dispose();
      textureRef.current = null;
      canvasRef.current = null;
      setTexture(null);
    };
  }, []);

  if (!logoImage || !prepared?.uvRegions) return null;
  return texture;
}

type BagModelProps = Pick<
  BagViewer3DProps,
  | "productId"
  | "bagColor"
  | "logoUrl"
  | "logoScale"
  | "logoPositionX"
  | "logoPositionY"
  | "logoRotation"
  | "logoPlacementMode"
  | "onLogoPositionChange"
  | "showLogoHint"
  | "isCompact"
  | "debugModelPath"
> & {
  onFramingChange: (framing: ReturnType<typeof getBagViewerFraming>) => void;
  uvDebugDraft?: BagUvRegions | null;
  onUvRegionsResolved?: (payload: UvRegionsResolvedPayload) => void;
};

function BagModel({
  productId,
  bagColor,
  logoUrl,
  logoScale,
  logoPositionX,
  logoPositionY,
  logoRotation,
  logoPlacementMode = "controls",
  onLogoPositionChange,
  showLogoHint,
  isCompact = false,
  onFramingChange,
  debugModelPath = null,
  uvDebugDraft = null,
  onUvRegionsResolved,
}: BagModelProps) {
  const modelPath = resolveConfiguratorModelPath(productId, debugModelPath);
  const gltf = useGLTF(modelPath, true);
  const { logoImage, aspectRatio } = useLogoImage(logoUrl);
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  const prepared = useMemo(
    () => prepareBagMesh(gltf.scene, modelPath, uvDebugDraft),
    [gltf.scene, modelPath, uvDebugDraft]
  );
  const albedoTexture = useBagUvAlbedoTexture({
    bagColor,
    logoImage,
    aspectRatio,
    logoScale,
    logoPositionX,
    logoPositionY,
    logoRotation,
    prepared,
  });

  useEffect(() => {
    if (!prepared || !onUvRegionsResolved) return;
    onUvRegionsResolved({
      modelPath,
      autoRegions: prepared.autoUvRegions,
      activeRegions: prepared.uvRegions,
      geometry: prepared.geometry,
    });
  }, [modelPath, onUvRegionsResolved, prepared]);

  const framing = useMemo(() => {
    if (!prepared) return getDefaultFraming(productId, isCompact);
    return getBagViewerFraming(productId, prepared.height, isCompact);
  }, [productId, prepared, isCompact]);

  useEffect(() => {
    onFramingChange(framing);
  }, [framing, onFramingChange]);

  const draggingRef = useRef(false);
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);

  const dragEnabled = logoPlacementMode === "drag" && !!logoImage && !!prepared?.uvRegions;

  const updatePositionFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const mesh = meshRef.current;
      const regions = prepared?.uvRegions;
      if (!mesh || !onLogoPositionChange || !regions) return;

      const rect = gl.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const [hit] = raycaster.intersectObject(mesh, false);
      if (!hit?.uv || !hit.face) return;

      const nz = hit.face.normal.z;
      if (Math.abs(nz) < 0.55) return;

      const footprint = mesh.userData.footprint as number;
      const height = mesh.userData.height as number;
      const region = nz < 0 ? regions.back : regions.front;
      const scalars = logoPlacementScalars(region, footprint, height);
      const next = uvPointToLogoState(hit.uv.x, hit.uv.y, scalars);
      onLogoPositionChange(next.x, next.y);
    },
    [camera, gl, onLogoPositionChange, pointer, prepared?.uvRegions, raycaster]
  );

  useEffect(() => {
    if (!dragEnabled) {
      gl.domElement.style.cursor = "";
      return;
    }

    gl.domElement.style.cursor = "grab";

    const handlePointerMove = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      event.preventDefault();
      updatePositionFromClient(event.clientX, event.clientY);
    };

    const endDrag = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      gl.domElement.style.cursor = "grab";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);

    return () => {
      gl.domElement.style.cursor = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [dragEnabled, gl, updatePositionFromClient]);

  const handlePointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!dragEnabled) return;
      event.stopPropagation();
      draggingRef.current = true;
      gl.domElement.style.cursor = "grabbing";
      updatePositionFromClient(event.clientX, event.clientY);
    },
    [dragEnabled, gl, updatePositionFromClient]
  );

  useEffect(() => {
    const mat = materialRef.current;
    if (!mat) return;
    if (albedoTexture) {
      mat.map = albedoTexture;
      mat.color.set("#ffffff");
    } else {
      mat.map = null;
      mat.color.set(bagColor);
    }
    mat.needsUpdate = true;
  }, [albedoTexture, bagColor]);

  useEffect(() => {
    const mat = materialRef.current;
    if (!mat) return;
    mat.normalMap = prepared?.normalMap ?? null;
    mat.normalScale.set(0.85, 0.85);
    mat.needsUpdate = true;
  }, [prepared?.normalMap]);

  if (!prepared) return null;

  const { geometry, height, footprint, frontZ } = prepared;

  return (
    <group rotation={[0.02, -0.46, 0]} scale={framing.sizeScale}>
      <mesh
        ref={(node) => {
          meshRef.current = node;
          if (node) {
            node.userData.footprint = footprint;
            node.userData.height = height;
          }
        }}
        geometry={geometry}
        onPointerDown={handlePointerDown}
      >
        <meshStandardMaterial
          ref={materialRef}
          roughness={0.72}
          metalness={0.04}
          side={THREE.FrontSide}
        />
      </mesh>

      {showLogoHint && !logoImage ? (
        <mesh position={[0, height * 0.52, frontZ + 0.04]} renderOrder={2}>
          <planeGeometry args={[footprint * 0.78, height * 0.38]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.18} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
}

function PedestalMeshes({ radius }: { radius: number }) {
  const discTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) return null;

    const center = canvas.width / 2;
    const gradient = context.createRadialGradient(center, center, 24, center, center, center);
    gradient.addColorStop(0, "rgba(210, 198, 178, 0.55)");
    gradient.addColorStop(0.55, "rgba(210, 198, 178, 0.28)");
    gradient.addColorStop(1, "rgba(210, 198, 178, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);

  useEffect(() => {
    return () => {
      discTexture?.dispose();
    };
  }, [discTexture]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
      <circleGeometry args={[radius, 128]} />
      <meshBasicMaterial
        map={discTexture ?? undefined}
        color="#e3d9c8"
        transparent
        toneMapped={false}
        depthWrite={false}
      />
    </mesh>
  );
}

function EntranceRig({
  children,
  pedestalRadius,
}: {
  children: React.ReactNode;
  pedestalRadius: number;
}) {
  const bagRef = useRef<THREE.Group>(null);
  const pedestalRef = useRef<THREE.Group>(null);
  const elapsedRef = useRef(0);
  const finishedRef = useRef(false);

  useFrame((_, delta) => {
    if (finishedRef.current) return;

    elapsedRef.current += delta;
    const elapsed = elapsedRef.current;

    const pedestalProgress = Math.min(1, elapsed / ENTRANCE_PEDESTAL_DURATION_S);
    const pedestalEased = easeOutCubic(pedestalProgress);

    if (pedestalRef.current) {
      const scale = THREE.MathUtils.lerp(0.68, 1, pedestalEased);
      pedestalRef.current.scale.setScalar(scale);
      pedestalRef.current.position.y = THREE.MathUtils.lerp(
        PEDESTAL_REST_Y - 0.12,
        PEDESTAL_REST_Y,
        pedestalEased
      );
    }

    const bagElapsed = Math.max(0, elapsed - ENTRANCE_BAG_DELAY_S);
    const bagProgress = Math.min(1, bagElapsed / ENTRANCE_BAG_DURATION_S);
    const bagEased = easeOutBack(bagProgress);

    if (bagRef.current) {
      bagRef.current.position.y = THREE.MathUtils.lerp(BAG_START_Y, BAG_REST_Y, bagEased);
      const bagScale = THREE.MathUtils.lerp(0.94, 1, bagEased);
      bagRef.current.scale.setScalar(bagScale);
    }

    if (pedestalProgress >= 1 && bagProgress >= 1) {
      finishedRef.current = true;
      if (bagRef.current) {
        bagRef.current.position.y = BAG_REST_Y;
        bagRef.current.scale.setScalar(1);
      }
      if (pedestalRef.current) {
        pedestalRef.current.position.y = PEDESTAL_REST_Y;
        pedestalRef.current.scale.setScalar(1);
      }
    }
  });

  return (
    <>
      <group ref={pedestalRef} position={[0, PEDESTAL_REST_Y - 0.12, 0]} scale={0.68}>
        <PedestalMeshes radius={pedestalRadius} />
      </group>
      <group ref={bagRef} position={[0, BAG_START_Y, 0]} scale={0.94}>
        {children}
      </group>
    </>
  );
}

function ViewerScene({
  productId,
  bagColor,
  logoUrl,
  logoScale,
  logoPositionX,
  logoPositionY,
  logoRotation,
  logoPlacementMode = "controls",
  onLogoPositionChange,
  autoRotate,
  showLogoHint,
  isCompact = false,
  onApiReady,
  uvDebugDraft = null,
  onUvRegionsResolved,
  debugModelPath = null,
}: BagViewer3DProps) {
  const { camera, gl, scene } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const lockCamera = logoPlacementMode === "drag" && !!logoUrl;
  const modelPath = resolveConfiguratorModelPath(productId, debugModelPath);

  const initialFraming = useMemo(
    () => getDefaultFraming(productId, isCompact),
    [productId, isCompact]
  );
  const framingRef = useRef(initialFraming);
  const [framing, setFraming] = useState(initialFraming);

  const handleFramingChange = useCallback((next: typeof initialFraming) => {
    framingRef.current = next;
    setFraming(next);
  }, []);

  useEffect(() => {
    const defaults = getDefaultFraming(productId, isCompact);
    framingRef.current = defaults;
    setFraming(defaults);
  }, [productId, isCompact]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.target.set(...framing.orbitTarget);
    controls.minDistance = framing.minDistance;
    controls.maxDistance = framing.maxDistance;
    controls.update();
  }, [framing]);

  useEffect(() => {
    camera.position.set(...framing.cameraPosition);
  }, [camera, framing.cameraPosition]);

  useEffect(() => {
    onApiReady({
      screenshot: async () => {
        try {
          const previousPixelRatio = gl.getPixelRatio();
          const capturePixelRatio = Math.min(2.5, window.devicePixelRatio || 1);
          gl.setPixelRatio(capturePixelRatio);
          gl.render(scene, camera);
          const dataUrl = gl.domElement.toDataURL("image/png");
          gl.setPixelRatio(previousPixelRatio);
          return dataUrl;
        } catch {
          return "";
        }
      },
      resetView: () => {
        const f = framingRef.current;
        camera.position.set(...f.cameraPosition);
        const controls = controlsRef.current;
        if (controls) {
          controls.target.set(...f.orbitTarget);
          controls.minDistance = f.minDistance;
          controls.maxDistance = f.maxDistance;
          controls.update();
        }
      },
      recordVideo: async (options = {}) => {
        const seconds = Math.min(20, Math.max(4, options.seconds ?? 8));
        const fps = Math.min(60, Math.max(24, options.fps ?? 30));
        const canvas = gl.domElement;

        if (typeof MediaRecorder === "undefined" || !canvas.captureStream) {
          throw new Error("הדפדפן לא תומך בהקלטת וידאו");
        }

        gl.render(scene, camera);
        const stream = canvas.captureStream(fps);
        const { mimeType } = pickVideoMimeType();
        const chunks: BlobPart[] = [];

        const controls = controlsRef.current;
        const prevAutoRotate = controls?.autoRotate ?? false;
        const prevSpeed = controls?.autoRotateSpeed ?? 1.5;

        // Drive a deterministic, exactly-one-full-turn (360°) spin over the
        // capture duration so the recorded clip ALWAYS completes a full
        // revolution — independent of fps/timing. autoRotate is disabled so it
        // doesn't double-drive the angle. Each frame we set the azimuth from
        // elapsed time and render, so the captured MediaStream shows the spin.
        if (controls) controls.autoRotate = false;
        const startAngle =
          controls && typeof controls.getAzimuthalAngle === "function"
            ? controls.getAzimuthalAngle()
            : 0;

        let rafId = 0;
        const startT = performance.now();
        const spin = (now: number) => {
          const fraction = Math.min(1, (now - startT) / (seconds * 1000));
          if (controls && typeof controls.setAzimuthalAngle === "function") {
            controls.setAzimuthalAngle(startAngle - fraction * Math.PI * 2);
            controls.update();
          }
          gl.render(scene, camera);
          rafId = requestAnimationFrame(spin);
        };
        rafId = requestAnimationFrame(spin);

        const recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 4_500_000,
        });

        try {
          return await new Promise<Blob>((resolve, reject) => {
            recorder.ondataavailable = (event) => {
              if (event.data.size > 0) chunks.push(event.data);
            };
            recorder.onerror = () => {
              reject(new Error("הקלטת וידאו נכשלה"));
            };
            recorder.onstop = () => {
              resolve(new Blob(chunks, { type: mimeType }));
            };
            recorder.start(250);
            window.setTimeout(() => {
              if (recorder.state !== "inactive") recorder.stop();
            }, seconds * 1000);
          });
        } finally {
          cancelAnimationFrame(rafId);
          stream.getTracks().forEach((track) => track.stop());
          if (controls) {
            controls.autoRotate = prevAutoRotate;
            controls.autoRotateSpeed = prevSpeed;
          }
        }
      },
    });
  }, [camera, gl, onApiReady, scene]);

  return (
    <>
      <PerspectiveCamera makeDefault position={framing.cameraPosition} fov={framing.fov} />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enabled={!lockCamera}
        enablePan={false}
        target={framing.orbitTarget}
        minDistance={framing.minDistance}
        maxDistance={framing.maxDistance}
        minPolarAngle={0.7}
        maxPolarAngle={1.72}
        autoRotate={autoRotate && !lockCamera}
        autoRotateSpeed={1.5}
      />

      <color attach="background" args={[BACKDROP_COLOR]} />
      <ambientLight intensity={1.05} />
      <hemisphereLight color="#fffaf3" groundColor="#d9d1c4" intensity={0.62} />
      <directionalLight position={[2.5, 6, 5]} intensity={1.2} />
      <directionalLight position={[-4, 3, 2.5]} intensity={0.38} />
      <directionalLight position={[0, 2, -4]} intensity={0.22} />

      <EntranceRig pedestalRadius={framing.pedestalRadius}>
        <React.Suspense fallback={null}>
          <BagModel
            key={modelPath}
            productId={productId}
            bagColor={bagColor}
            logoUrl={logoUrl}
            logoScale={logoScale}
            logoPositionX={logoPositionX}
            logoPositionY={logoPositionY}
            logoRotation={logoRotation}
            logoPlacementMode={logoPlacementMode}
            onLogoPositionChange={onLogoPositionChange}
            showLogoHint={showLogoHint}
            isCompact={isCompact}
            onFramingChange={handleFramingChange}
            debugModelPath={debugModelPath}
            uvDebugDraft={uvDebugDraft}
            onUvRegionsResolved={onUvRegionsResolved}
          />
        </React.Suspense>
      </EntranceRig>
    </>
  );
}

export const BagViewer3D = ({
  uvDebug = false,
  debugModelPath = null,
  uvDebugDraft = null,
  onUvDebugDraftChange,
  onUvRegionsResolved,
  ...props
}: BagViewer3DProps) => {
  const [resolvedUv, setResolvedUv] = useState<UvRegionsResolvedPayload | null>(null);

  const handleUvRegionsResolved = useCallback(
    (payload: UvRegionsResolvedPayload) => {
      setResolvedUv(payload);
      onUvRegionsResolved?.(payload);
    },
    [onUvRegionsResolved]
  );

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Canvas
        dpr={[1, 2.5]}
        gl={{
          preserveDrawingBuffer: true,
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        }}
        style={{ width: "100%", height: "100%", touchAction: "none" }}
      >
        <ViewerScene
          {...props}
          debugModelPath={debugModelPath}
          uvDebugDraft={uvDebugDraft}
          onUvRegionsResolved={handleUvRegionsResolved}
        />
      </Canvas>

      {uvDebug && resolvedUv ? (
        <UvIslandDebugOverlay
          modelPath={resolvedUv.modelPath}
          autoRegions={resolvedUv.autoRegions}
          activeRegions={resolvedUv.activeRegions}
          geometry={resolvedUv.geometry}
          onDraftChange={onUvDebugDraftChange ?? (() => {})}
        />
      ) : null}
    </div>
  );
};

export default BagViewer3D;

for (const path of ALL_BAG_GLB_PATHS) {
  useGLTF.preload(path, true);
}
