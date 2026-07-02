"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Download, RotateCcw } from "lucide-react";
import type * as THREE from "three";
import type { BagUvRegions, UvPrintRegion } from "@/lib/configurator/bag-uv-regions";
import {
  cloneUvRegions,
  loadUvDebugDraft,
  regionsToConfigSnippet,
  regionsToJson,
  saveUvDebugDraft,
} from "@/lib/configurator/bag-uv-islands";
import { downloadUvMapPng, extractUvMapToCanvas } from "@/lib/configurator/extract-uv-map";

const PREVIEW_SIZE = 200;

function drawUvPreview(
  canvas: HTMLCanvasElement,
  front: UvPrintRegion,
  back: UvPrintRegion
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = PREVIEW_SIZE;
  canvas.width = size;
  canvas.height = size;

  ctx.fillStyle = "#2a2520";
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const t = (i / 4) * size;
    ctx.beginPath();
    ctx.moveTo(t, 0);
    ctx.lineTo(t, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, t);
    ctx.lineTo(size, t);
    ctx.stroke();
  }

  const rect = (r: UvPrintRegion, color: string, label: string) => {
    const x = r.minU * size;
    const y = (1 - r.maxV) * size;
    const w = (r.maxU - r.minU) * size;
    const h = (r.maxV - r.minV) * size;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#fff";
    ctx.font = "11px monospace";
    ctx.fillText(label, x + 4, y + 14);
  };

  rect(front, "#f472b6", "front");
  rect(back, "#60a5fa", "back");
}

function RegionFields({
  label,
  region,
  onChange,
}: {
  label: string;
  region: UvPrintRegion;
  onChange: (patch: Partial<UvPrintRegion>) => void;
}) {
  const fields: Array<{ key: keyof UvPrintRegion; label: string }> = [
    { key: "minU", label: "minU" },
    { key: "maxU", label: "maxU" },
    { key: "minV", label: "minV" },
    { key: "maxV", label: "maxV" },
  ];

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {fields.map((f) => (
          <label key={f.key} style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 2 }}>
            {f.label}
            <input
              type="number"
              step="0.001"
              min={0}
              max={1}
              value={region[f.key]}
              onChange={(e) => onChange({ [f.key]: Number(e.target.value) })}
              style={{
                width: "100%",
                padding: "4px 6px",
                borderRadius: 6,
                border: "1px solid rgba(0,0,0,0.15)",
                fontFamily: "monospace",
                fontSize: 11,
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export interface UvIslandDebugOverlayProps {
  modelPath: string;
  autoRegions: BagUvRegions | null;
  activeRegions: BagUvRegions | null;
  geometry: THREE.BufferGeometry | null;
  onDraftChange: (regions: BagUvRegions | null) => void;
}

export function UvIslandDebugOverlay({
  modelPath,
  autoRegions,
  activeRegions,
  geometry,
  onDraftChange,
}: UvIslandDebugOverlayProps) {
  const seed = activeRegions ?? autoRegions;
  const [draft, setDraft] = useState<BagUvRegions | null>(() => {
    return loadUvDebugDraft(modelPath) ?? (seed ? cloneUvRegions(seed) : null);
  });
  const [copied, setCopied] = useState<string | null>(null);
  const [uvMapPreview, setUvMapPreview] = useState<string | null>(null);
  const [uvMapLoading, setUvMapLoading] = useState(false);

  useEffect(() => {
    const next = loadUvDebugDraft(modelPath) ?? (seed ? cloneUvRegions(seed) : null);
    setDraft(next);
  }, [modelPath, seed]);

  useEffect(() => {
    if (!geometry) {
      setUvMapPreview(null);
      return;
    }

    let cancelled = false;
    setUvMapLoading(true);

    const timer = window.setTimeout(() => {
      const canvas = extractUvMapToCanvas(geometry, {
        size: 640,
        islandOverlay: draft,
        colorCodeExterior: true,
      });
      if (cancelled) return;
      setUvMapPreview(canvas?.toDataURL("image/png") ?? null);
      setUvMapLoading(false);
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [draft, geometry]);

  const uvMapFileName = useMemo(() => {
    const base = modelPath.replace(/^\//, "").replace(/\.glb$/i, "");
    return `${base}-uv-map.png`;
  }, [modelPath]);

  const downloadUvMap = useCallback(() => {
    if (!geometry) return;
    downloadUvMapPng(geometry, uvMapFileName, {
      size: 2048,
      islandOverlay: draft,
      colorCodeExterior: true,
    });
  }, [draft, geometry, uvMapFileName]);

  const openUvMap = useCallback(() => {
    if (!geometry) return;
    const canvas = extractUvMapToCanvas(geometry, {
      size: 2048,
      islandOverlay: draft,
      colorCodeExterior: true,
    });
    if (!canvas) return;
    const win = window.open("");
    if (!win) return;
    win.document.write(`<img src="${canvas.toDataURL("image/png")}" style="max-width:100%;background:#111" />`);
    win.document.title = uvMapFileName;
  }, [draft, geometry, uvMapFileName]);

  const previewRef = useCallback(
    (node: HTMLCanvasElement | null) => {
      if (!node || !draft) return;
      drawUvPreview(node, draft.front, draft.back);
    },
    [draft]
  );

  const applyDraft = useCallback(() => {
    if (!draft) return;
    saveUvDebugDraft(modelPath, draft);
    onDraftChange(cloneUvRegions(draft));
  }, [draft, modelPath, onDraftChange]);

  const resetToAuto = useCallback(() => {
    if (!autoRegions) return;
    const next = cloneUvRegions(autoRegions);
    setDraft(next);
    saveUvDebugDraft(modelPath, next);
    onDraftChange(next);
  }, [autoRegions, modelPath, onDraftChange]);

  const copyJson = useCallback(async () => {
    if (!draft) return;
    const text = regionsToJson(modelPath, draft, "uv-debug");
    await navigator.clipboard.writeText(text);
    setCopied("JSON");
    window.setTimeout(() => setCopied(null), 2000);
  }, [draft, modelPath]);

  const copySnippet = useCallback(async () => {
    if (!draft) return;
    const text = regionsToConfigSnippet(modelPath, draft);
    await navigator.clipboard.writeText(text);
    setCopied("snippet");
    window.setTimeout(() => setCopied(null), 2000);
  }, [draft, modelPath]);

  const autoJson = useMemo(
    () => (autoRegions ? regionsToJson(modelPath, autoRegions, "auto-exterior") : null),
    [autoRegions, modelPath]
  );

  if (!draft) {
    return (
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 20,
          background: "rgba(20,18,16,0.92)",
          color: "#fff",
          padding: 12,
          borderRadius: 10,
          fontSize: 12,
          maxWidth: 280,
        }}
      >
        UV debug: no regions detected for {modelPath}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        zIndex: 20,
        background: "rgba(20,18,16,0.94)",
        color: "#f5f0e8",
        padding: 12,
        borderRadius: 12,
        fontSize: 12,
        width: 340,
        maxHeight: "calc(100% - 24px)",
        overflowY: "auto",
        boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>UV island debug</div>
      <div style={{ opacity: 0.75, fontSize: 11, marginBottom: 10, wordBreak: "break-all" }}>
        {modelPath}
      </div>

      <canvas ref={previewRef} style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE, borderRadius: 8, marginBottom: 10 }} />

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Full UV unwrap</div>
        {uvMapLoading ? (
          <div style={{ fontSize: 11, opacity: 0.7, padding: "24px 0" }}>Generating UV map…</div>
        ) : uvMapPreview ? (
          <img
            src={uvMapPreview}
            alt="UV map"
            style={{ width: "100%", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)" }}
          />
        ) : (
          <div style={{ fontSize: 11, opacity: 0.7 }}>No geometry loaded</div>
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={downloadUvMap}
            disabled={!geometry}
            style={btnStyle("#e8dfd0", "#1c1815")}
          >
            <Download size={14} /> PNG
          </button>
          <button
            type="button"
            onClick={openUvMap}
            disabled={!geometry}
            style={btnStyle("transparent", "#f5f0e8")}
          >
            Open full size
          </button>
        </div>
        <div style={{ fontSize: 10, opacity: 0.55, marginTop: 6 }}>
          Pink = exterior front, blue = exterior back, gray = rest
        </div>
      </div>

      <RegionFields
        label="Front island"
        region={draft.front}
        onChange={(patch) => setDraft((prev) => (prev ? { ...prev, front: { ...prev.front, ...patch } } : prev))}
      />
      <RegionFields
        label="Back island"
        region={draft.back}
        onChange={(patch) => setDraft((prev) => (prev ? { ...prev, back: { ...prev.back, ...patch } } : prev))}
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        <button type="button" onClick={applyDraft} style={btnStyle("#e8dfd0", "#1c1815")}>
          Apply preview
        </button>
        <button type="button" onClick={resetToAuto} style={btnStyle("transparent", "#f5f0e8")} title="Reset to auto exterior">
          <RotateCcw size={14} />
        </button>
        <button type="button" onClick={copyJson} style={btnStyle("transparent", "#f5f0e8")}>
          <Copy size={14} /> JSON
        </button>
        <button type="button" onClick={copySnippet} style={btnStyle("transparent", "#f5f0e8")}>
          <Copy size={14} /> snippet
        </button>
      </div>

      {copied ? (
        <div style={{ color: "#86efac", fontSize: 11, marginBottom: 8 }}>Copied {copied} — paste in chat</div>
      ) : null}

      <div style={{ fontSize: 10, opacity: 0.65, lineHeight: 1.45 }}>
        Pink = front, blue = back. Tune minU/maxU/minV/maxV, hit Apply, then Copy snippet for{" "}
        <code style={{ fontSize: 10 }}>bag-uv-islands.ts</code>.
      </div>

      {autoJson ? (
        <details style={{ marginTop: 10, fontSize: 10 }}>
          <summary style={{ cursor: "pointer", opacity: 0.8 }}>Auto-detected (exterior)</summary>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 6, opacity: 0.75 }}>{autoJson}</pre>
        </details>
      ) : null}
    </div>
  );
}

function btnStyle(bg: string, color: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.2)",
    background: bg,
    color,
    cursor: "pointer",
    fontSize: 11,
  };
}
