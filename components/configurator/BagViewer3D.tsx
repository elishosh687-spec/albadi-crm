"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { colors } from "@/lib/ui/tokens";

interface BagModelProps {
  bagColor: string;
  logoUrl?: string | null;
  logoScale: number;
  logoPositionX: number;
  logoPositionY: number;
  onScreenshotReady: (callback: () => Promise<string>) => void;
}

const BAG_MODEL_PATH = "/Rusable_Bag.glb";
const MODEL_SCALE = 1.62;
const MODEL_FRONT_Z = 0.49;

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

function BagModel({
  bagColor,
  logoUrl,
  logoScale,
  logoPositionX,
  logoPositionY,
}: Omit<BagModelProps, "onScreenshotReady">) {
  const gltf = useGLTF(BAG_MODEL_PATH, true);
  const { texture, aspectRatio } = useLogoTexture(logoUrl);
  const fabricTexture = useFabricTexture(bagColor);

  const modelScene = useMemo(() => {
    const clonedScene = gltf.scene.clone(true);

    clonedScene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    return clonedScene;
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
    modelScene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.material = modelMaterial;
      }
    });

    return () => {
      modelMaterial.dispose();
    };
  }, [modelMaterial, modelScene]);

  const logoWidth = Math.min(0.86, 0.5 * logoScale * Math.max(aspectRatio, 0.65));
  const logoHeight = Math.min(0.5, 0.5 * logoScale / Math.max(aspectRatio, 0.65));
  const logoX = logoPositionX * 0.4;
  const logoY = 0.36 + logoPositionY * 0.5;

  return (
    <group rotation={[0.02, -0.46, 0]} position={[0, -1.42, 0]} scale={MODEL_SCALE}>
      <primitive object={modelScene} />

      <mesh position={[0, 0.36, MODEL_FRONT_Z]} renderOrder={2}>
        <planeGeometry args={[0.92, 0.58]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={texture ? 0.055 : 0.17} />
      </mesh>

      {texture ? (
        <mesh position={[logoX, logoY, MODEL_FRONT_Z + 0.012]} renderOrder={3}>
          <planeGeometry args={[logoWidth, logoHeight]} />
          <meshStandardMaterial
            map={texture}
            transparent
            alphaTest={0.04}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ) : null}
    </group>
  );
}

function ViewerScene({
  bagColor,
  logoUrl,
  logoScale,
  logoPositionX,
  logoPositionY,
  onScreenshotReady,
}: BagModelProps) {
  const { camera, gl, scene } = useThree();

  useEffect(() => {
    onScreenshotReady(async () => {
      try {
        gl.render(scene, camera);
        return gl.domElement.toDataURL("image/png");
      } catch {
        return "";
      }
    });
  }, [camera, gl, onScreenshotReady, scene]);

  return (
    <>
      <PerspectiveCamera makeDefault position={[0.28, 0.18, 8.2]} fov={32} />
      <OrbitControls
        enablePan={false}
        target={[0, 0.1, 0]}
        minDistance={5.8}
        maxDistance={10}
        minPolarAngle={0.85}
        maxPolarAngle={1.72}
        minAzimuthAngle={-1.18}
        maxAzimuthAngle={0.55}
      />

      <color attach="background" args={[colors.surfaceMuted]} />
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

      <BagModel
        bagColor={bagColor}
        logoUrl={logoUrl}
        logoScale={logoScale}
        logoPositionX={logoPositionX}
        logoPositionY={logoPositionY}
      />

      <mesh position={[0, -1.72, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[2.4, 48]} />
        <meshBasicMaterial color="#d9d1c5" transparent opacity={0.32} />
      </mesh>
    </>
  );
}

export const BagViewer3D = ({
  bagColor,
  logoUrl,
  logoScale,
  logoPositionX,
  logoPositionY,
  onScreenshotReady,
}: BagModelProps) => {
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
        <ViewerScene
          bagColor={bagColor}
          logoUrl={logoUrl}
          logoScale={logoScale}
          logoPositionX={logoPositionX}
          logoPositionY={logoPositionY}
          onScreenshotReady={onScreenshotReady}
        />
      </Canvas>
    </div>
  );
};

export default BagViewer3D;

useGLTF.preload(BAG_MODEL_PATH, true);
