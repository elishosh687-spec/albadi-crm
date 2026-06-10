"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Decal, OrbitControls, PerspectiveCamera, useGLTF } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";

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
  autoRotate: boolean;
  showLogoHint: boolean;
  onApiReady: (api: ViewerApi) => void;
}

const BAG_MODEL_PATH = "/Rusable_Bag.glb";
const MODEL_SCALE = 1.62;
const BACKDROP_COLOR = "#f0e9dc";
const DEFAULT_CAMERA_POSITION: [number, number, number] = [0.28, 0.18, 8.2];
const DEFAULT_TARGET: [number, number, number] = [0, 0.22, 0];

// Decal coordinates live in the bag mesh's local space (front face sits at z ≈ +0.28).
const DECAL_FRONT_Z = 0.26;
const DECAL_BASE_Y = -0.5;

function useFabricTexture(hex: string) {
  return useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;

    const context = canvas.getContext("2d");
    if (!context) return null;

    context.fillStyle = hex;
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < canvas.height; y += 3) {
      context.fillStyle = y % 6 === 0 ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.035)";
      context.fillRect(0, y, canvas.width, 1);
    }

    for (let x = 0; x < canvas.width; x += 4) {
      context.fillStyle = x % 8 === 0 ? "rgba(255,255,255,0.028)" : "rgba(0,0,0,0.025)";
      context.fillRect(x, 0, 1, canvas.height);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2.4, 2.8);
    texture.anisotropy = 8;

    return texture;
  }, [hex]);
}

function useLogoTexture(logoUrl?: string | null) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [aspectRatio, setAspectRatio] = useState(1);

  useEffect(() => {
    let disposed = false;
    let nextTexture: THREE.Texture | null = null;

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

        loadedTexture.colorSpace = THREE.SRGBColorSpace;
        loadedTexture.anisotropy = 8;
        loadedTexture.needsUpdate = true;
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
  }, [logoUrl]);

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
  | "showLogoHint"
>;

function BagModel({
  bagColor,
  logoUrl,
  logoScale,
  logoPositionX,
  logoPositionY,
  logoRotation,
  showLogoHint,
}: BagModelProps) {
  const gltf = useGLTF(BAG_MODEL_PATH, true);
  const { texture, aspectRatio } = useLogoTexture(logoUrl);
  const fabricTexture = useFabricTexture(bagColor);

  const bagSource = useMemo(() => {
    let mesh: THREE.Mesh | null = null;
    gltf.scene.traverse((object) => {
      if (!mesh && object instanceof THREE.Mesh) {
        mesh = object;
      }
    });
    return mesh as THREE.Mesh | null;
  }, [gltf.scene]);

  const modelMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: bagColor,
        map: fabricTexture ?? undefined,
        roughness: 0.88,
        metalness: 0,
        envMapIntensity: 0.28,
        side: THREE.DoubleSide,
      }),
    [bagColor, fabricTexture]
  );

  useEffect(() => {
    return () => {
      modelMaterial.dispose();
    };
  }, [modelMaterial]);

  if (!bagSource) return null;

  const clampedAspect = Math.max(aspectRatio, 0.65);
  const decalWidth = Math.min(0.86, 0.5 * logoScale * clampedAspect);
  const decalHeight = Math.min(0.5, (0.5 * logoScale) / clampedAspect);
  const decalX = logoPositionX * 0.42;
  const decalY = DECAL_BASE_Y + logoPositionY * 0.55;

  return (
    <group rotation={[0.02, -0.46, 0]} position={[0, -1.35, 0]} scale={MODEL_SCALE}>
      <mesh
        geometry={bagSource.geometry}
        position={bagSource.position}
        castShadow
        receiveShadow
        material={modelMaterial}
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

function Pedestal() {
  return (
    <group position={[0, -1.75, 0]}>
      <mesh receiveShadow position={[0, 0.035, 0]}>
        <cylinderGeometry args={[1.62, 1.78, 0.07, 64]} />
        <meshStandardMaterial color="#e6ddcc" roughness={0.96} metalness={0} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.073, 0]} receiveShadow>
        <circleGeometry args={[1.58, 64]} />
        <meshStandardMaterial color="#ded3bf" transparent opacity={0.55} roughness={1} />
      </mesh>
    </group>
  );
}

function ViewerScene({
  bagColor,
  logoUrl,
  logoScale,
  logoPositionX,
  logoPositionY,
  logoRotation,
  autoRotate,
  showLogoHint,
  onApiReady,
}: BagViewer3DProps) {
  const { camera, gl, scene } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  useEffect(() => {
    onApiReady({
      screenshot: async () => {
        try {
          gl.render(scene, camera);
          return gl.domElement.toDataURL("image/png");
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
      <PerspectiveCamera makeDefault position={DEFAULT_CAMERA_POSITION} fov={32} />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enablePan={false}
        target={DEFAULT_TARGET}
        minDistance={5.2}
        maxDistance={11}
        minPolarAngle={0.7}
        maxPolarAngle={1.72}
        autoRotate={autoRotate}
        autoRotateSpeed={1.5}
      />

      <color attach="background" args={[BACKDROP_COLOR]} />
      <ambientLight intensity={1.15} />
      <hemisphereLight color="#fffaf3" groundColor="#d9d1c4" intensity={0.85} />
      <directionalLight
        position={[3.5, 5.4, 4.5]}
        intensity={1.45}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-3.5, 2, 3]} intensity={0.38} />

      <React.Suspense fallback={null}>
        <BagModel
          bagColor={bagColor}
          logoUrl={logoUrl}
          logoScale={logoScale}
          logoPositionX={logoPositionX}
          logoPositionY={logoPositionY}
          logoRotation={logoRotation}
          showLogoHint={showLogoHint}
        />
      </React.Suspense>

      <Pedestal />
    </>
  );
}

export const BagViewer3D = (props: BagViewer3DProps) => {
  return (
    <div className="h-full w-full overflow-hidden">
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={[1, 1.75]}
        gl={{
          preserveDrawingBuffer: true,
          antialias: true,
          alpha: false,
        }}
        style={{ width: "100%", height: "100%" }}
      >
        <ViewerScene {...props} />
      </Canvas>
    </div>
  );
};

export default BagViewer3D;

useGLTF.preload(BAG_MODEL_PATH, true);
