"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Image as ImageIcon, Loader2, Search, Send, Video, X } from "lucide-react";
import { colors, fontStack, radius, size, space, weight } from "@/lib/ui/tokens";
import { getConfiguratorApiBase } from "@/lib/configurator/urls";

interface RecentLead {
  sid: string | null;
  name: string | null;
  phone: string | null;
  stage: string | null;
  updatedAt?: string | null;
}

type MediaType = "image" | "video";

type SendStatus =
  | { kind: "idle" }
  | { kind: "recording"; sid: string }
  | { kind: "sending"; sid: string }
  | { kind: "sent"; name: string }
  | { kind: "error"; message: string };

/**
 * Agent-mode overlay: search all contacts (ordered by most-recent
 * conversation) and send the current 3D mockup to the picked contact.
 * Same-origin fetch with the widget token (configurator embedded in the hub).
 */
export default function ContactPickerOverlay({
  widgetToken,
  getScreenshot,
  getVideo,
  baseName = "bag-mockup",
  onClose,
  isCompact = false,
}: {
  widgetToken: string;
  getScreenshot: () => Promise<string>;
  getVideo: () => Promise<{ blob: Blob; extension: "mp4" | "webm" }>;
  baseName?: string;
  onClose: () => void;
  isCompact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [leads, setLeads] = useState<RecentLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<SendStatus>({ kind: "idle" });
  const [mediaType, setMediaType] = useState<MediaType>("image");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounce the typeahead query.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(id);
  }, [query]);

  // Fetch contacts on (debounced) query change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const apiBase = getConfiguratorApiBase();
    const params = new URLSearchParams({ widget_token: widgetToken, limit: "50" });
    if (debouncedQuery) params.set("q", debouncedQuery);
    fetch(`${apiBase}/api/widget/leads/recent?${params.toString()}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; leads?: RecentLead[] }
          | null;
        if (cancelled) return;
        if (!res.ok || !data?.ok) {
          setLeads([]);
          setLoadError("טעינת אנשי הקשר נכשלה");
          return;
        }
        setLeads(data.leads ?? []);
      })
      .catch(() => {
        if (!cancelled) setLoadError("טעינת אנשי הקשר נכשלה");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, widgetToken]);

  const busy = status.kind === "recording" || status.kind === "sending";
  const activeSid =
    status.kind === "recording" || status.kind === "sending" ? status.sid : null;

  const handlePick = async (lead: RecentLead) => {
    const sid = lead.sid?.trim();
    if (!sid || busy) return;
    try {
      // Build the file payload for the chosen media type.
      let file: Blob;
      let filename: string;
      if (mediaType === "video") {
        // Recording the rotation takes several seconds — show a clear state
        // and keep the rest of the picker disabled meanwhile.
        setStatus({ kind: "recording", sid });
        const { blob, extension } = await getVideo();
        if (!blob || blob.size === 0) throw new Error("הקלטת הווידאו נכשלה");
        file = blob;
        filename = `${baseName}.${extension}`;
      } else {
        setStatus({ kind: "sending", sid });
        const imageDataUrl = await getScreenshot();
        if (!imageDataUrl) throw new Error("לא ניתן ללכוד את התצוגה");
        // Convert the PNG data URL to a Blob so both paths send raw bytes.
        file = await (await fetch(imageDataUrl)).blob();
        filename = `${baseName}.png`;
      }

      setStatus({ kind: "sending", sid });
      const form = new FormData();
      form.append("file", file, filename);
      form.append("manychatSubId", sid);
      form.append("widgetToken", widgetToken);
      form.append("mediaType", mediaType);
      form.append("filename", filename);

      const apiBase = getConfiguratorApiBase();
      const res = await fetch(`${apiBase}/api/configurator/send-to-customer`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; detail?: string }
        | null;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.detail || data?.error || `שליחה נכשלה (${res.status})`);
      }
      setStatus({ kind: "sent", name: lead.name?.trim() || "הלקוח" });
      window.setTimeout(() => onClose(), 1600);
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "שליחה נכשלה" });
    }
  };

  const headerNote = useMemo(
    () => "בחר איש קשר — ממוין לפי השיחה האחרונה",
    []
  );

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(28,24,21,0.28)",
          zIndex: 30,
        }}
      />
      <aside
        dir="rtl"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          insetInlineEnd: 0,
          width: isCompact ? "100%" : "min(420px, 100%)",
          background: colors.surface,
          boxShadow: isCompact ? "none" : "-8px 0 32px rgba(28,24,21,0.18)",
          zIndex: 31,
          display: "flex",
          flexDirection: "column",
          fontFamily: fontStack.body,
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: space.md,
            padding: `${space.lg}px ${space.lg}px ${space.md}px`,
            borderBottom: `1px solid ${colors.ruleSoft}`,
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontFamily: fontStack.display,
                fontSize: size.lg,
                fontWeight: weight.medium,
                color: colors.ink,
              }}
            >
              שליחת הדמיה ללקוח
            </h2>
            <p style={{ margin: `${space.xs}px 0 0`, fontSize: size.xs, color: colors.inkMuted }}>
              {headerNote}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגור"
            title="סגור"
            style={{
              width: 36,
              height: 36,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              borderRadius: radius.full,
              border: "none",
              background: colors.surfaceMuted,
              color: colors.inkMuted,
              cursor: "pointer",
            }}
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: `${space.md}px ${space.lg}px` }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: space.sm,
              padding: `${space.sm}px ${space.md}px`,
              borderRadius: radius.full,
              border: `1px solid ${colors.rule}`,
              background: colors.surfaceMuted,
            }}
          >
            <Search className="size-4" style={{ color: colors.inkSubtle, flexShrink: 0 }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חפש לפי שם או טלפון…"
              dir="rtl"
              style={{
                flex: 1,
                minWidth: 0,
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: size.sm,
                color: colors.ink,
                fontFamily: fontStack.body,
              }}
            />
            {loading ? (
              <Loader2 className="size-4 animate-spin" style={{ color: colors.inkSubtle }} />
            ) : null}
          </div>

          {/* Media-type toggle: image (default) / video */}
          <div
            role="tablist"
            aria-label="סוג מדיה לשליחה"
            style={{
              display: "flex",
              marginTop: space.md,
              padding: 3,
              gap: 3,
              borderRadius: radius.full,
              background: colors.surfaceMuted,
              border: `1px solid ${colors.ruleSoft}`,
            }}
          >
            {(
              [
                { id: "image" as const, label: "תמונה", Icon: ImageIcon },
                { id: "video" as const, label: "וידאו", Icon: Video },
              ]
            ).map(({ id, label, Icon }) => {
              const active = mediaType === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active ? "true" : "false"}
                  onClick={() => setMediaType(id)}
                  disabled={busy}
                  style={{
                    flex: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    minHeight: 36,
                    borderRadius: radius.full,
                    border: "none",
                    background: active ? colors.ink : "transparent",
                    color: active ? colors.surface : colors.inkMuted,
                    fontSize: size.xs,
                    fontWeight: active ? weight.semibold : weight.regular,
                    cursor: busy ? "default" : "pointer",
                    opacity: busy && !active ? 0.55 : 1,
                  }}
                >
                  <Icon className="size-3.5 shrink-0" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Banner: sent / error */}
        {status.kind === "sent" ? (
          <div
            style={{
              margin: `0 ${space.lg}px ${space.md}px`,
              padding: `${space.sm}px ${space.md}px`,
              borderRadius: radius.lg,
              background: colors.successBg,
              color: colors.success,
              fontSize: size.sm,
              fontWeight: weight.medium,
              display: "flex",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            <Check className="size-4" />
            {`נשלח ל${status.name} ✓`}
          </div>
        ) : status.kind === "error" ? (
          <div
            style={{
              margin: `0 ${space.lg}px ${space.md}px`,
              padding: `${space.sm}px ${space.md}px`,
              borderRadius: radius.lg,
              background: colors.dangerBg,
              color: colors.danger,
              fontSize: size.sm,
              fontWeight: weight.medium,
            }}
          >
            {status.message}
          </div>
        ) : null}

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto", padding: `0 ${space.sm}px ${space.lg}px` }}>
          {loadError && leads.length === 0 ? (
            <p style={{ textAlign: "center", color: colors.danger, fontSize: size.sm, marginTop: space.xl }}>
              {loadError}
            </p>
          ) : !loading && leads.length === 0 ? (
            <p style={{ textAlign: "center", color: colors.inkMuted, fontSize: size.sm, marginTop: space.xl }}>
              לא נמצאו אנשי קשר
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              {leads.map((lead, idx) => {
                const sid = lead.sid?.trim() ?? "";
                const isActive = activeSid === sid;
                const isRecording = isActive && status.kind === "recording";
                const disabled = busy || !sid;
                return (
                  <li key={sid || `row-${idx}`}>
                    <button
                      type="button"
                      onClick={() => void handlePick(lead)}
                      disabled={disabled}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: space.md,
                        padding: `${space.md}px ${space.md}px`,
                        borderRadius: radius.lg,
                        border: "none",
                        background: "transparent",
                        textAlign: "right",
                        cursor: disabled ? "default" : "pointer",
                        opacity: disabled && !isActive ? 0.55 : 1,
                      }}
                      onMouseEnter={(e) => {
                        if (!disabled) e.currentTarget.style.background = colors.surfaceMuted;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: size.sm,
                            fontWeight: weight.medium,
                            color: colors.ink,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {lead.name?.trim() || "ללא שם"}
                        </div>
                        <div
                          style={{
                            fontSize: size.xs,
                            color: colors.inkMuted,
                            display: "flex",
                            gap: space.sm,
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          {lead.phone ? (
                            <span style={{ fontVariantNumeric: "tabular-nums" }} dir="ltr">
                              {lead.phone}
                            </span>
                          ) : null}
                          {lead.stage ? (
                            <span
                              style={{
                                padding: `1px ${space.sm}px`,
                                borderRadius: radius.full,
                                background: colors.surfaceMuted,
                                color: colors.inkMuted,
                                fontSize: 11,
                              }}
                            >
                              {lead.stage}
                            </span>
                          ) : null}
                          {isActive ? (
                            <span style={{ color: colors.accent, fontWeight: weight.medium }}>
                              {isRecording ? "מקליט וידאו…" : "שולח…"}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 32,
                          height: 32,
                          flexShrink: 0,
                          display: "grid",
                          placeItems: "center",
                          borderRadius: radius.full,
                          background: isActive ? colors.accent : colors.accentSoft,
                          color: isActive ? colors.surface : colors.accent,
                        }}
                      >
                        {isActive ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Send className="size-3.5" />
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
