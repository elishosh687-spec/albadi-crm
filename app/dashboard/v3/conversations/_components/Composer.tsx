"use client";

import { useEffect, useState, useTransition } from "react";
import { Send, Sparkles, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  suggestRepliesAction,
  sendManualReply,
  setBotPaused,
  listTemplatesAction,
  sendTemplateAction,
  type TemplateRow,
} from "@/app/actions/v2";

export function Composer({
  sid,
  phone,
  initialBotPaused,
}: {
  sid: string;
  phone: string | null;
  initialBotPaused: boolean;
}) {
  const [text, setText] = useState("");
  const [hint, setHint] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showPauseAsk, setShowPauseAsk] = useState(false);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  useEffect(() => {
    listTemplatesAction().then((r) => {
      if (r.ok) setTemplates((r.templates ?? []).filter((t) => t.active));
    });
  }, []);

  const sendTemplate = (templateId: number) => {
    setShowTemplatePicker(false);
    const tmpl = templates.find((t) => t.id === templateId);
    if (tmpl?.type === "restart_questionnaire") {
      const ok = window.confirm(
        `איפוס שאלון: ה-qState של הליד יתאפס ו-3 הודעות ישלחו (הקדמה + OPENING + שאלת משלוח). להמשיך?`
      );
      if (!ok) return;
    }
    setMsg(null);
    startTransition(async () => {
      const r = await sendTemplateAction(sid, templateId);
      setMsg({ ok: r.ok, text: r.ok ? "נשלח" : r.error ?? "כשל" });
    });
  };

  const waLink = phone
    ? `https://wa.me/${phone.replace(/[^0-9]/g, "")}`
    : null;

  const suggest = () => {
    setMsg(null);
    startTransition(async () => {
      const r = await suggestRepliesAction(sid, hint || undefined);
      if (r.ok) setSuggestions(r.replies);
      else setMsg({ ok: false, text: r.error });
    });
  };

  const onSendClick = () => {
    const clean = text.trim();
    if (!clean) return;
    setPendingText(clean);
    setShowPauseAsk(true);
  };

  const doSend = (alsoPauseBot: boolean) => {
    if (!pendingText) return;
    setMsg(null);
    startTransition(async () => {
      if (!alsoPauseBot && initialBotPaused === false) {
        // sendManualReply always pauses the bot. If the user does NOT want to
        // pause, we un-pause right after — kept as a single atomic-ish step.
      }
      const r = await sendManualReply(sid, pendingText);
      if (r.ok && !alsoPauseBot) {
        // Restore bot to running.
        await setBotPaused(sid, false);
      }
      setMsg({
        ok: r.ok,
        text: r.ok
          ? alsoPauseBot
            ? "נשלח. הבוט מושהה לליד הזה."
            : "נשלח. הבוט ממשיך."
          : r.error ?? "כשל",
      });
      if (r.ok) {
        setText("");
        setSuggestions([]);
        setPendingText(null);
        setShowPauseAsk(false);
      }
    });
  };

  return (
    <div className="border-t border-border bg-card/60 p-3 space-y-2">
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Sparkles className="size-2.5" />
            הצעות מה-LLM
          </div>
          <div className="flex flex-col gap-1">
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setText(s)}
                className="text-right text-sm border border-border bg-background/40 rounded-lg p-2 hover:bg-secondary line-clamp-3"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="כתוב הודעה ללקוח…"
          className="flex-1 bg-background/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-y"
          dir="auto"
        />
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={suggest}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Sparkles className="size-3" />
            הצע
          </button>
          <button
            type="button"
            onClick={onSendClick}
            disabled={isPending || !text.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Send className="size-3" />
            שלח
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <input
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          placeholder="רמז להצעות (למשל: ‘הצע הנחה 5%’)"
          className="flex-1 bg-background/30 border border-border rounded-md px-2 py-1 text-xs focus:outline-none"
        />
        {templates.length > 0 && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowTemplatePicker((v) => !v)}
              disabled={isPending}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <Send className="size-3" />
              תבנית
            </button>
            {showTemplatePicker && (
              <div className="absolute bottom-full mb-1 left-0 z-30 min-w-[180px] rounded-lg border border-border bg-card shadow-xl py-1">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => sendTemplate(t.id)}
                    className="w-full text-right px-3 py-2 text-xs hover:bg-secondary flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{t.name}</span>
                    {t.type === "cta_url" && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">CTA</span>
                    )}
                    {t.type === "restart_questionnaire" && (
                      <span className="shrink-0 text-[10px] text-amber-400">↻</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {waLink && (
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground shrink-0"
          >
            פתח ב-WhatsApp
            <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      {showPauseAsk && (
        <div
          className="rounded-lg border border-border bg-background/80 p-3 flex flex-col gap-2"
          role="dialog"
        >
          <p className="text-sm">להשהות את הבוט לליד הזה אחרי השליחה?</p>
          <p className="text-xs text-muted-foreground">
            השהיה = הבוט יפסיק לענות אוטומטית; אתה מנהל את השיחה ידנית. השאר פעיל
            = הבוט ימשיך לסבב הבא.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => doSend(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-warning/20 border border-warning/40 text-warning px-3 py-1.5 text-xs"
            >
              שלח + השהה בוט
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => doSend(false)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs hover:bg-secondary"
            >
              שלח, השאר בוט פעיל
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setShowPauseAsk(false);
                setPendingText(null);
              }}
              className="text-xs text-muted-foreground hover:text-foreground mr-auto"
            >
              ביטול
            </button>
          </div>
        </div>
      )}

      {msg && (
        <p
          className={cn(
            "text-xs",
            msg.ok ? "text-success" : "text-destructive"
          )}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
