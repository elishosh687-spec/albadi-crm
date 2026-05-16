"use client";

import { useState, useRef, useEffect } from "react";
import { MessageSquare, X, Send, Loader2, ChevronDown } from "lucide-react";

const STAGES = [
  { value: "ALL", label: "כל הלידים" },
  { value: "NEW", label: "חדשים" },
  { value: "AWAITING_ESTIMATE", label: "ממתינים להצעה" },
  { value: "AWAITING_LOGO", label: "ממתינים ללוגו" },
  { value: "WAITING_FACTORY", label: "אצל המפעל" },
  { value: "AWAITING_FINAL", label: "ממתינים לאישור סופי" },
  { value: "WON", label: "נסגרו" },
  { value: "DROPPED", label: "ננטשו" },
];

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function AiChat() {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState("ALL");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    const history = messages.slice(-8);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, stage, history }),
      });

      if (!res.ok || !res.body) throw new Error("שגיאה בשרת");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let content = "";
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        content += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content };
          return next;
        });
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "שגיאה — נסה שוב." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const stageName = STAGES.find((s) => s.value === stage)?.label ?? "כל הלידים";

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 left-6 z-50 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-lg hover:bg-primary/90 transition-all"
        aria-label="שאל AI על לידים"
      >
        <MessageSquare className="h-5 w-5" />
        <span className="text-sm font-medium">AI CRM</span>
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-20 left-6 z-50 flex flex-col w-[380px] max-w-[calc(100vw-3rem)] h-[520px] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">שאל על לידים</span>
            </div>
            {/* Stage selector */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  className="appearance-none bg-background border border-border rounded-lg pl-6 pr-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                >
                  {STAGES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute left-1 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
            {messages.length === 0 && (
              <div className="text-muted-foreground text-center mt-8 space-y-2">
                <p className="text-lg">💬</p>
                <p>שאל שאלה על הלידים שלך</p>
                <p className="text-xs">למשל: &quot;מי הכי קרוב לסגירה?&quot; או &quot;למה לידים תקועים?&quot;</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 whitespace-pre-wrap leading-relaxed ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm"
                  }`}
                >
                  {m.content || (loading && i === messages.length - 1 ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : "")}
                </div>
              </div>
            ))}
            {loading && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex justify-end">
                <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2">
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Context indicator */}
          <div className="px-4 py-1 text-xs text-muted-foreground border-t border-border bg-muted/20">
            הקשר: {stageName}
          </div>

          {/* Input */}
          <div className="flex items-end gap-2 px-3 py-3 border-t border-border">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="שאל שאלה... (Enter לשליחה)"
              rows={1}
              className="flex-1 resize-none bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary max-h-24 overflow-y-auto"
              style={{ direction: "rtl" }}
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              className="shrink-0 flex items-center justify-center h-9 w-9 rounded-xl bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
