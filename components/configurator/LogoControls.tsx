"use client";

import React from "react";

interface LogoControlsProps {
  logoScale: number;
  logoPositionX: number;
  logoPositionY: number;
  logoRotation: number;
  onScaleChange: (scale: number) => void;
  onPositionXChange: (x: number) => void;
  onPositionYChange: (y: number) => void;
  onRotationChange: (rotation: number) => void;
  hasLogo: boolean;
}

export const LogoControls: React.FC<LogoControlsProps> = ({
  logoScale,
  logoPositionX,
  logoPositionY,
  logoRotation,
  onScaleChange,
  onPositionXChange,
  onPositionYChange,
  onRotationChange,
  hasLogo,
}) => {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-700">Logo Controls</h3>

      {!hasLogo && (
        <p className="text-xs text-gray-500 italic">
          Upload a logo to enable controls
        </p>
      )}

      {/* Scale */}
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">
          Size: {logoScale.toFixed(2)}
        </label>
        <input
          type="range"
          min="0.3"
          max="2"
          step="0.05"
          value={logoScale}
          onChange={(e) => onScaleChange(parseFloat(e.target.value))}
          disabled={!hasLogo}
          className="w-full disabled:opacity-50"
        />
      </div>

      {/* Position X */}
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">
          Position X: {logoPositionX.toFixed(2)}
        </label>
        <input
          type="range"
          min="-1"
          max="1"
          step="0.05"
          value={logoPositionX}
          onChange={(e) => onPositionXChange(parseFloat(e.target.value))}
          disabled={!hasLogo}
          className="w-full disabled:opacity-50"
        />
      </div>

      {/* Position Y */}
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">
          Position Y: {logoPositionY.toFixed(2)}
        </label>
        <input
          type="range"
          min="-1"
          max="1"
          step="0.05"
          value={logoPositionY}
          onChange={(e) => onPositionYChange(parseFloat(e.target.value))}
          disabled={!hasLogo}
          className="w-full disabled:opacity-50"
        />
      </div>

      {/* Rotation */}
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">
          Rotation: {logoRotation.toFixed(0)}°
        </label>
        <input
          type="range"
          min="0"
          max="360"
          step="5"
          value={logoRotation}
          onChange={(e) => onRotationChange(parseFloat(e.target.value))}
          disabled={!hasLogo}
          className="w-full disabled:opacity-50"
        />
      </div>

      {/* Reset Button */}
      <button
        onClick={() => {
          onScaleChange(1);
          onPositionXChange(0);
          onPositionYChange(0);
          onRotationChange(0);
        }}
        disabled={!hasLogo}
        className="w-full px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Reset Logo Position
      </button>
    </div>
  );
};

export default LogoControls;
