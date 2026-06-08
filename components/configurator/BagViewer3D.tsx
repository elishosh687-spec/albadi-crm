"use client";

import React, { useRef, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";

interface BagModelProps {
  bagColor: string;
  logoUrl?: string | null;
  logoScale: number;
  logoPositionX: number;
  logoPositionY: number;
  logoRotation: number;
  onScreenshotReady: (callback: () => Promise<string>) => void;
}

/**
 * Main bag mesh component (non-woven tote bag)
 */
const BagMesh = React.forwardRef<
  THREE.Group,
  Omit<BagModelProps, "onScreenshotReady">
>(
  (
    {
      bagColor,
      logoUrl,
      logoScale,
      logoPositionX,
      logoPositionY,
      logoRotation,
    },
    ref
  ) => {
    const groupRef = useRef<THREE.Group>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const textureRef = useRef<THREE.Texture | null>(null);

    React.useImperativeHandle(ref, () => groupRef.current as THREE.Group);

    // Load and prepare logo texture
    useEffect(() => {
      if (!logoUrl) return;

      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext("2d");

      if (!ctx) return;

      // Fill transparent background
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        // Calculate aspect-preserving dimensions
        const maxDim = canvas.width * 0.8;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          height = (height * maxDim) / width;
          width = maxDim;
        } else {
          width = (width * maxDim) / height;
          height = maxDim;
        }

        const x = (canvas.width - width) / 2;
        const y = (canvas.height - height) / 2;

        ctx.drawImage(img, x, y, width, height);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        textureRef.current = texture;
      };
      img.src = logoUrl;
      canvasRef.current = canvas;
    }, [logoUrl]);

    return (
      <group ref={groupRef} position={[0, 0, 0]}>
        {/* Bag Body - Main rectangular shape */}
        <mesh position={[0, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.5, 3, 0.6]} />
          <meshStandardMaterial
            color={bagColor}
            roughness={0.4}
            metalness={0.1}
          />
        </mesh>

        {/* Left Handle */}
        <mesh
          position={[-1.1, 1.5, 0]}
          rotation={[Math.PI * 0.3, 0, 0]}
          castShadow
        >
          <torusGeometry args={[0.4, 0.08, 8, 32, 0, Math.PI]} />
          <meshStandardMaterial
            color={bagColor}
            roughness={0.4}
            metalness={0.1}
          />
        </mesh>

        {/* Right Handle */}
        <mesh
          position={[1.1, 1.5, 0]}
          rotation={[Math.PI * 0.3, 0, 0]}
          castShadow
        >
          <torusGeometry args={[0.4, 0.08, 8, 32, 0, Math.PI]} />
          <meshStandardMaterial
            color={bagColor}
            roughness={0.4}
            metalness={0.1}
          />
        </mesh>

        {/* Logo Decal Plane - Front face of bag */}
        {textureRef.current && (
          <mesh
            position={[
              logoPositionX * 1.2,
              logoPositionY * 1.4,
              0.32,
            ]}
            rotation={[0, 0, (logoRotation * Math.PI) / 180]}
            castShadow
          >
            <planeGeometry args={[logoScale * 1.2, logoScale * 1.2]} />
            <meshStandardMaterial
              map={textureRef.current}
              transparent
              depthTest={true}
              depthWrite={false}
            />
          </mesh>
        )}

        {/* Placeholder for empty logo area */}
        {!textureRef.current && (
          <mesh position={[0, 0, 0.31]} castShadow>
            <planeGeometry args={[1.8, 2.2]} />
            <meshStandardMaterial
              color="#e5e7eb"
              transparent
              opacity={0.3}
            />
          </mesh>
        )}
      </group>
    );
  }
);

BagMesh.displayName = "BagMesh";

/**
 * Canvas Scene Component
 */
const BagScene = ({
  bagColor,
  logoUrl,
  logoScale,
  logoPositionX,
  logoPositionY,
  logoRotation,
  onScreenshotReady,
}: BagModelProps) => {
  const bagRef = useRef<THREE.Group>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { gl } = useThree();

  // Expose screenshot function
  useEffect(() => {
    onScreenshotReady(async () => {
      try {
        // Get the WebGL canvas and create a screenshot
        const canvas = gl.domElement as HTMLCanvasElement;
        return canvas.toDataURL("image/png");
      } catch (err) {
        console.error("Screenshot capture failed:", err);
        return "";
      }
    });
  }, [gl, onScreenshotReady]);

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, 5]} fov={50} />
      <OrbitControls
        enableZoom={true}
        minDistance={3}
        maxDistance={12}
        enablePan={true}
        autoRotate={false}
        autoRotateSpeed={2}
      />

      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[10, 10, 10]}
        intensity={0.8}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
      />
      <directionalLight position={[-5, 5, 5]} intensity={0.3} />

      {/* Background */}
      <color attach="background" args={["#f8f9fa"]} />

      {/* Bag Model */}
      <BagMesh
        ref={bagRef}
        bagColor={bagColor}
        logoUrl={logoUrl}
        logoScale={logoScale}
        logoPositionX={logoPositionX}
        logoPositionY={logoPositionY}
        logoRotation={logoRotation}
      />

      {/* Ground plane shadow */}
      <mesh position={[0, -2, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[10, 10]} />
        <shadowMaterial opacity={0.3} />
      </mesh>
    </>
  );
};

/**
 * BagViewer3D - Main component combining Canvas and Scene
 */
export const BagViewer3D = ({
  bagColor,
  logoUrl,
  logoScale,
  logoPositionX,
  logoPositionY,
  logoRotation,
  onScreenshotReady,
}: BagModelProps) => {
  return (
    <div className="w-full h-full bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg overflow-hidden">
      <Canvas
        shadows
        gl={{
          preserveDrawingBuffer: true,
          antialias: true,
          alpha: true,
        }}
        style={{ width: "100%", height: "100%" }}
      >
        <BagScene
          bagColor={bagColor}
          logoUrl={logoUrl}
          logoScale={logoScale}
          logoPositionX={logoPositionX}
          logoPositionY={logoPositionY}
          logoRotation={logoRotation}
          onScreenshotReady={onScreenshotReady}
        />
      </Canvas>
    </div>
  );
};

export default BagViewer3D;
