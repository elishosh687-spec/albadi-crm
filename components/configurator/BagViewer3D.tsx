"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Decal, OrbitControls, PerspectiveCamera, useGLTF } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";

export type LogoPlacementMode = "drag" | "controls";

export const LOGO_POSITION_LIMITS = {
  x: { min: -0.85, max: 0.85 },
  y: { min: -0.6, max: 0.75 },
} as const;

export interface ViewerApi {
  screenshot: () => Promise<string>;
  resetView: () => void;
}

interface BagViewer3DProps {
  bagColor: string;
  logoUrl?: string | null;
  logoScale: number;
  logoPositionX: number;
  logoPositionY: number;
  /** Degrees, rotates the decal around the surface normal. */
  logoRotation: number;
  logoPlacementMode?: LogoPlacementMode;
  onLogoPositionChange?: (positionX: number, positionY: number) => void;
  autoRotate: boolean;
  showLogoHint: boolean;
  isCompact?: boolean;
  onApiReady: (api: ViewerApi) => void;
}

const BAG_MODEL_PATH = "/Rusable_Bag.glb";
const MODEL_SCALE = 1.62;
const BACKDROP_COLOR = "#f0e9dc";
const DEFAULT_CAMERA_POSITION: [number, number, number] = [0.28, 1.2, 8.2];
const DEFAULT_TARGET: [number, number, number] = [0, 1.32, 0];
const BAG_REST_Y = 0.35;
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

// Decal coordinates live in the bag mesh's local space (front face sits at z ≈ +0.28).
const DECAL_FRONT_Z = 0.26;
const DECAL_BASE_Y = -0.5;
const LOGO_X_SCALE = 0.42;
const LOGO_Y_SCALE = 0.55;

function logoStateToDecalPosition(logoPositionX: number, logoPositionY: number) {
  return {
    x: logoPositionX * LOGO_X_SCALE,
    y: DECAL_BASE_Y + logoPositionY * LOGO_Y_SCALE,
  };
}

function decalLocalPointToLogoState(local: THREE.Vector3) {
  return {
    x: THREE.MathUtils.clamp(
      local.x / LOGO_X_SCALE,
      LOGO_POSITION_LIMITS.x.min,
      LOGO_POSITION_LIMITS.x.max
    ),
    y: THREE.MathUtils.clamp(
      (local.y - DECAL_BASE_Y) / LOGO_Y_SCALE,
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

  useEffect(() => {
    let disposed = false;
    let nextTexture: THREE.Texture | null = null;
    const maxAnisotropy = gl.capabilities.getMaxAnisotropy();

    if (!logoUrl) {
      setTexture((current) => {
        current?.dispose();
        return null;
      });
      setAspectRatio(1);
      return;
    }

    const loader = new THREE.TextureLoader();
    loader.load(
      logoUrl,
      (loadedTexture) => {
        if (disposed) {
          loadedTexture.dispose();
          return;
        }

        configureLogoTexture(loadedTexture, maxAnisotropy);
        nextTexture = loadedTexture;
        setAspectRatio(
          loadedTexture.image?.width && loadedTexture.image?.height
            ? loadedTexture.image.width / loadedTexture.image.height
            : 1
        );
        setTexture((current) => {
          current?.dispose();
          return loadedTexture;
        });
      },
      undefined,
      () => {
        if (!disposed) {
          setTexture((current) => {
            current?.dispose();
            return null;
          });
          setAspectRatio(1);
        }
      }
    );

    return () => {
      disposed = true;
      if (nextTexture) nextTexture.dispose();
    };
  }, [gl, logoUrl]);

  return { texture, aspectRatio };
}

type BagModelProps = Pick<
  BagViewer3DProps,
  | "bagColor"
  | "logoUrl"
  | "logoScale"
  | "logoPositionX"
  | "logoPositionY"
  | "logoRotation"
  | "logoPlacementMode"
  | "onLogoPositionChange"
  | "showLogoHint"
>;

function BagModel({
  bagColor,
  logoUrl,
  logoScale,
  logoPositionX,
  logoPositionY,
  logoRotation,
  logoPlacementMode = "controls",
  onLogoPositionChange,
  showLogoHint,
}: BagModelProps) {
  const gltf = useGLTF(BAG_MODEL_PATH, true);
  const { texture, aspectRatio } = useLogoTexture(logoUrl);
  const meshRef = useRef<THREE.Mesh>(null);
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
      const next = decalLocalPointToLogoState(local);
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

  const bagSource = useMemo(() => {
    let mesh: THREE.Mesh | null = null;
    gltf.scene.traverse((object) => {
      if (!mesh && object instanceof THREE.Mesh) {
        mesh = object;
      }
    });
    return mesh as THREE.Mesh | null;
  }, [gltf.scene]);

  const bagGeometry = useMemo(() => {
    if (!bagSource) return null;
    return bagSource.geometry.clone();
  }, [bagSource]);

  const modelMaterial = useMemo(
    () =>
      new THREE.MeshLambertMaterial({
        color: bagColor,
        side: THREE.FrontSide,
      }),
    [bagColor]
  );

  useEffect(() => {
    return () => {
      modelMaterial.dispose();
    };
  }, [modelMaterial]);

  if (!bagSource || !bagGeometry) return null;

  const clampedAspect = Math.max(aspectRatio, 0.65);
  const decalWidth = Math.min(0.86, 0.5 * logoScale * clampedAspect);
  const decalHeight = Math.min(0.5, (0.5 * logoScale) / clampedAspect);
  const { x: decalX, y: decalY } = logoStateToDecalPosition(logoPositionX, logoPositionY);

  return (
    <group rotation={[0.02, -0.46, 0]} scale={MODEL_SCALE}>
      <mesh
        ref={meshRef}
        geometry={bagGeometry}
        position={bagSource.position}
        material={modelMaterial}
        onPointerDown={handlePointerDown}
      >
        {texture ? (
          <Decal
            position={[decalX, decalY, DECAL_FRONT_Z]}
            rotation={[0, 0, -THREE.MathUtils.degToRad(logoRotation)]}
            scale={[decalWidth, decalHeight, 0.32]}
            map={texture}
            depthTest
          />
        ) : null}
      </mesh>

      {showLogoHint && !texture ? (
        <mesh position={[0, 0.36, 0.31]} renderOrder={2}>
          <planeGeometry args={[0.92, 0.58]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.18} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
}

function PedestalMeshes() {
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
      <circleGeometry args={[1.72, 128]} />
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

function EntranceRig({ children }: { children: React.ReactNode }) {
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
        <PedestalMeshes />
      </group>
      <group ref={bagRef} position={[0, BAG_START_Y, 0]} scale={0.94}>
        {children}
      </group>
    </>
  );
}

function ViewerScene({
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
        camera.position.set(...DEFAULT_CAMERA_POSITION);
        const controls = controlsRef.current;
        if (controls) {
          controls.target.set(...DEFAULT_TARGET);
          controls.update();
        }
      },
    });
  }, [camera, gl, onApiReady, scene]);

  return (
    <>
      <PerspectiveCamera makeDefault position={DEFAULT_CAMERA_POSITION} fov={isCompact ? 36 : 32} />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enabled={!lockCamera}
        enablePan={false}
        target={DEFAULT_TARGET}
        minDistance={5.2}
        maxDistance={11}
        minPolarAngle={0.7}
        maxPolarAngle={1.72}
        autoRotate={autoRotate && !lockCamera}
        autoRotateSpeed={1.5}
      />

      <color attach="background" args={[BACKDROP_COLOR]} />
      <ambientLight intensity={1.35} />
      <hemisphereLight color="#fffaf3" groundColor="#d9d1c4" intensity={0.65} />
      <directionalLight position={[3.5, 5.4, 4.5]} intensity={0.95} />
      <directionalLight position={[-3.5, 2, 3]} intensity={0.28} />

      <React.Suspense fallback={null}>
        <EntranceRig>
          <BagModel
            bagColor={bagColor}
            logoUrl={logoUrl}
            logoScale={logoScale}
            logoPositionX={logoPositionX}
            logoPositionY={logoPositionY}
            logoRotation={logoRotation}
            logoPlacementMode={logoPlacementMode}
            onLogoPositionChange={onLogoPositionChange}
            showLogoHint={showLogoHint}
          />
        </EntranceRig>
      </React.Suspense>
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

useGLTF.preload(BAG_MODEL_PATH, true);
