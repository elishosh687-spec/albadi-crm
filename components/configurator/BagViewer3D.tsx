"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, useGLTF } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import {
  ALL_BAG_GLB_PATHS,
  getBagGlbPathForProduct,
} from "@/lib/configurator/bag-models";
import { BAG_REST_Y, getBagViewerFraming, getDefaultFraming } from "@/lib/configurator/bag-framing";
import { pickVideoMimeType } from "@/lib/configurator/download-mockup";
import { prepareBagMesh } from "@/lib/configurator/prepare-bag-mesh";

export type LogoPlacementMode = "drag" | "controls";

export const LOGO_POSITION_LIMITS = {
  x: { min: -0.85, max: 0.85 },
  y: { min: -0.6, max: 0.75 },
} as const;

export interface RecordVideoOptions {
  seconds?: number;
  fps?: number;
}

export interface ViewerApi {
  screenshot: () => Promise<string>;
  resetView: () => void;
  recordVideo: (options?: RecordVideoOptions) => Promise<Blob>;
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

function logoStateToDecalPosition(
  logoPositionX: number,
  logoPositionY: number,
  footprint: number,
  height: number
) {
  const xScale = footprint * 0.48;
  const yScale = height * 0.38;
  const baseY = height * 0.28;
  return {
    x: logoPositionX * xScale,
    y: baseY + logoPositionY * yScale,
    xScale,
    yScale,
    baseY,
  };
}

function decalLocalPointToLogoState(
  local: THREE.Vector3,
  xScale: number,
  yScale: number,
  baseY: number
) {
  return {
    x: THREE.MathUtils.clamp(
      local.x / xScale,
      LOGO_POSITION_LIMITS.x.min,
      LOGO_POSITION_LIMITS.x.max
    ),
    y: THREE.MathUtils.clamp(
      (local.y - baseY) / yScale,
      LOGO_POSITION_LIMITS.y.min,
      LOGO_POSITION_LIMITS.y.max
    ),
  };
}

function configureLogoTexture(texture: THREE.Texture, maxAnisotropy: number) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.max(1, maxAnisotropy);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
}

function useLogoTexture(logoUrl?: string | null) {
  const { gl } = useThree();
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [aspectRatio, setAspectRatio] = useState(1);
  const textureRef = useRef<THREE.Texture | null>(null);

  useEffect(() => {
    let cancelled = false;
    const maxAnisotropy = gl.capabilities.getMaxAnisotropy();

    if (!logoUrl) {
      setTexture(null);
      setAspectRatio(1);
      return () => {
        textureRef.current?.dispose();
        textureRef.current = null;
      };
    }

    const loader = new THREE.TextureLoader();
    loader.load(
      logoUrl,
      (loadedTexture) => {
        if (cancelled) {
          loadedTexture.dispose();
          return;
        }
        configureLogoTexture(loadedTexture, maxAnisotropy);
        textureRef.current?.dispose();
        textureRef.current = loadedTexture;
        setAspectRatio(
          loadedTexture.image?.width && loadedTexture.image?.height
            ? loadedTexture.image.width / loadedTexture.image.height
            : 1
        );
        setTexture(loadedTexture);
      },
      undefined,
      () => {
        if (!cancelled) {
          setTexture(null);
          setAspectRatio(1);
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [gl, logoUrl]);

  useEffect(() => {
    return () => {
      textureRef.current?.dispose();
      textureRef.current = null;
    };
  }, []);

  return { texture, aspectRatio };
}

/** Plane logo on the bag front — avoids drei Decal removeChild races on model swap. */
function BagLogoPlane({
  texture,
  position,
  rotationZ,
  width,
  height,
}: {
  texture: THREE.Texture;
  position: [number, number, number];
  rotationZ: number;
  width: number;
  height: number;
}) {
  return (
    <mesh position={position} rotation={[0, 0, rotationZ]} renderOrder={2}>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial
        map={texture}
        transparent
        depthTest
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-2}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  );
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
> & {
  onFramingChange: (framing: ReturnType<typeof getBagViewerFraming>) => void;
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
}: BagModelProps) {
  const modelPath = getBagGlbPathForProduct(productId);
  const gltf = useGLTF(modelPath, true);
  const { texture, aspectRatio } = useLogoTexture(logoUrl);
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  const prepared = useMemo(() => prepareBagMesh(gltf.scene), [gltf.scene, modelPath]);

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

  const dragEnabled = logoPlacementMode === "drag" && !!texture;

  const updatePositionFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const mesh = meshRef.current;
      if (!mesh || !onLogoPositionChange) return;

      const rect = gl.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const [hit] = raycaster.intersectObject(mesh, false);
      if (!hit) return;

      const local = mesh.worldToLocal(hit.point.clone());
      const footprint = mesh.userData.footprint as number;
      const height = mesh.userData.height as number;
      const { xScale, yScale, baseY } = logoStateToDecalPosition(0, 0, footprint, height);
      const next = decalLocalPointToLogoState(local, xScale, yScale, baseY);
      onLogoPositionChange(next.x, next.y);
    },
    [camera, gl, onLogoPositionChange, pointer, raycaster]
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
    mat.color.set(bagColor);
  }, [bagColor]);

  useEffect(() => {
    const mat = materialRef.current;
    if (!mat) return;
    mat.normalMap = prepared?.normalMap ?? null;
    mat.normalScale.set(0.85, 0.85);
    mat.needsUpdate = true;
  }, [prepared?.normalMap]);

  if (!prepared) return null;

  const { geometry, height, footprint, frontZ } = prepared;
  const clampedAspect = Math.max(aspectRatio, 0.65);
  const logoWidth = Math.min(footprint * 0.72, footprint * 0.42 * logoScale * clampedAspect);
  const logoHeight = Math.min(height * 0.42, (height * 0.42 * logoScale) / clampedAspect);
  const { x: logoX, y: logoY } = logoStateToDecalPosition(
    logoPositionX,
    logoPositionY,
    footprint,
    height
  );
  const logoZ = frontZ + 0.008;

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
          side={THREE.DoubleSide}
        />
      </mesh>

      {texture ? (
        <BagLogoPlane
          texture={texture}
          position={[logoX, logoY, logoZ]}
          rotationZ={-THREE.MathUtils.degToRad(logoRotation)}
          width={logoWidth}
          height={logoHeight}
        />
      ) : null}

      {showLogoHint && !texture ? (
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
}: BagViewer3DProps) {
  const { camera, gl, scene } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const lockCamera = logoPlacementMode === "drag" && !!logoUrl;
  const modelPath = getBagGlbPathForProduct(productId);

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

        if (controls) {
          controls.autoRotate = true;
          controls.autoRotateSpeed = 2.4;
          controls.update();
        }

        // Drive the rotation ourselves for the duration of the capture. R3F's
        // own loop won't reliably advance OrbitControls.autoRotate every frame,
        // so without this the captured stream is static (looks like a still).
        // Each frame: advance auto-rotation + render so the canvas — and thus
        // the captured MediaStream — actually shows the bag spinning.
        let rafId = 0;
        let lastT = performance.now();
        const spin = (now: number) => {
          const dt = (now - lastT) / 1000;
          lastT = now;
          if (controls) {
            // autoRotate advances on update(); nudge azimuth by speed*dt as a
            // fallback in case update() doesn't apply rotation on its own.
            controls.update();
            try {
              controls.setAzimuthalAngle(
                controls.getAzimuthalAngle() - (controls.autoRotateSpeed * dt) / 6
              );
            } catch {
              /* some control builds lack the helpers — update() covers it */
            }
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
          />
        </React.Suspense>
      </EntranceRig>
    </>
  );
}

export const BagViewer3D = (props: BagViewer3DProps) => {
  return (
    <div className="h-full w-full overflow-hidden">
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
        <ViewerScene {...props} />
      </Canvas>
    </div>
  );
};

export default BagViewer3D;

for (const path of ALL_BAG_GLB_PATHS) {
  useGLTF.preload(path, true);
}
