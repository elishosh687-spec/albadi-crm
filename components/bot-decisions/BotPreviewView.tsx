"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

interface UpcomingRow {
  sid: string;
  name: string | null;
  stage: string;
  attempt: number;
  sendAt: string;
  ghlUrl: string | null;
}
interface DraftRow { id: number; sid: string; name: string | null; moneyReason: string | null; draftText: string; ghlUrl: string | null; }
interface FactoryRow { id: string; sid: string; name: string | null; status: string; ghlUrl: string | null; }
interface PausedRow { sid: string; name: string | null; stage: string | null; ghlUrl: string | null; }

interface PreviewData {
  now: string;
  upcoming: UpcomingRow[];
  drafts: DraftRow[];
  factory: FactoryRow[];
  paused: PausedRow[];
}

export function BotPreviewView({ apiToken }: { apiToken: string }) {
  const [data, setData] = useState<PreviewData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/bot/preview?widget_token=${encodeURIComponent(apiToken)}`);
        if (!r.ok) throw new Error(`${r.status}`);
        setData(await r.json());
      } catch (e) {
        setErr(e instanceof Error ? e.message : "fetch failed");
      }
    })();
  }, [apiToken]);

  if (err) return <div className="text-red-400 text-sm">שגיאה: {err}</div>;
  if (!data) return <div className="text-muted-foreground text-sm">טוען...</div>;

  const now = new Date(data.now);

  return (
    <div className="flex flex-col gap-4">
      <Section title={`📞 פולואפים מתוכננים (${data.upcoming.length})`}>
        {data.upcoming.length === 0 ? (
          <Empty>אין פולואפים מתוכננים</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-xs">
              <tr><Th>מתי</Th><Th>ניסיון</Th><Th>שלב</Th><Th>ליד</Th><Th>GHL</Th></tr>
            </thead>
            <tbody>
              {data.upcoming.map((u, i) => {
                const delta = new Date(u.sendAt).getTime() - now.getTime();
                return (
                  <tr key={i} className="border-t border-border">
                    <Td><WhenBadge ms={delta} /></Td>
                    <Td>{u.attempt}/3</Td>
                    <Td className="text-indigo-300 text-xs">{u.stage}</Td>
                    <Td>{u.name ?? u.sid.slice(0, 25)}</Td>
                    <Td>{u.ghlUrl ? <LinkBtn href={u.ghlUrl} /> : <span className="text-muted-foreground">—</span>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={`✋ טיוטות ממתינות (${data.drafts.length})`}>
        {data.drafts.length === 0 ? <Empty>אין טיוטות</Empty> : (
          data.drafts.map(d => (
            <div key={d.id} className="py-2 border-t border-border first:border-t-0 flex gap-3 items-start">
              <div className="flex-1">
                <div className="text-xs text-amber-400">#{d.id} · {d.moneyReason ?? "—"} · {d.name ?? d.sid.slice(0, 25)}</div>
                <div className="text-sm mt-1">{(d.draftText ?? "").slice(0, 200)}</div>
              </div>
              {d.ghlUrl && <LinkBtn href={d.ghlUrl} />}
            </div>
          ))
        )}
      </Section>

      <Section title={`🏭 בקשות מפעל פתוחות (${data.factory.length})`}>
        {data.factory.length === 0 ? <Empty>אין בקשות פתוחות</Empty> : (
          data.factory.map(f => (
            <div key={f.id} className="py-1.5 border-t border-border first:border-t-0 text-sm flex justify-between items-center">
              <div>
                <span className={f.status === "received" ? "text-amber-400" : "text-muted-foreground"}>{f.status}</span>
                <span className="mx-2 text-muted-foreground">·</span>
                <span>{f.name ?? f.sid.slice(0, 30)}</span>
              </div>
              {f.ghlUrl && <LinkBtn href={f.ghlUrl} />}
            </div>
          ))
        )}
      </Section>

      <Section title={`😴 הבוט מושהה (${data.paused.length})`}>
        {data.paused.length === 0 ? <Empty>הבוט פעיל לכולם</Empty> : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {data.paused.map(p => (
              <div key={p.sid} className="px-2 py-1.5 rounded bg-card/40 text-sm flex justify-between items-center">
                <div>
                  <div className="truncate">{p.name ?? p.sid.slice(0, 25)}</div>
                  <div className="text-xs text-muted-foreground">{p.stage ?? "no stage"}</div>
                </div>
                {p.ghlUrl && <LinkBtn href={p.ghlUrl} compact />}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card/40 p-3">
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      {children}
    </section>
  );
}
function Th({ children }: { children: React.ReactNode }) { return <th className="text-right py-1 px-2 font-normal">{children}</th>; }
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`py-1.5 px-2 ${className}`}>{children}</td>;
}
function Empty({ children }: { children: React.ReactNode }) { return <div className="text-muted-foreground text-sm">{children}</div>; }
function WhenBadge({ ms }: { ms: number }) {
  const mins = Math.round(ms / 60000);
  if (mins < 0) {
    const m = -mins;
    const t = m < 60 ? `${m}m` : m < 1440 ? `${(m/60).toFixed(1)}h` : `${(m/1440).toFixed(1)}d`;
    return <span className="text-red-400 font-medium">{t} באיחור</span>;
  }
  if (mins < 60) return <span className="text-emerald-400">בעוד {mins}m</span>;
  return <span className="text-blue-400">בעוד {(mins/60).toFixed(1)}h</span>;
}
function LinkBtn({ href, compact = false }: { href: string; compact?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 rounded-md border border-border bg-secondary/40 hover:bg-secondary text-xs font-medium ${compact ? "p-1" : "px-2 py-1"} transition-colors`}
      title="פתח ב-GHL (טאב חדש)"
    >
      <ExternalLink className="size-3" />
      {!compact && <span>GHL</span>}
    </a>
  );
}
