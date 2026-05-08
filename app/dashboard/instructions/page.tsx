import { Page } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { colors, fontStack, leading, radius, size, space, weight } from "@/lib/ui/tokens";

export default function InstructionsPage() {
  return (
    <div>
      <Page
        eyebrow="מדריך שימוש"
        title="איך להשתמש ב-Albadi CRM"
        description="כל מה שצריך לדעת על הבוט, הכפתורים, וההסלמות."
      />

      <Card title="מה הבוט עושה" eyebrow="סקירה כללית">
        <P>
          הבוט רץ אוטומטית <strong>כל שעה</strong> דרך Cloud Routine. בכל ריצה הוא:
        </P>
        <List>
          <li>שואב את כל הלידים הפעילים מטבלת leads</li>
          <li>מקבל מ-ManyChat את התגים, ה-notes, וה-quote_total של כל ליד</li>
          <li>מסווג כל ליד לפי כללים (rule-based) — מי מחכה, מי קיבל הצעה, מי תקוע</li>
          <li>שומר החלטה ב-DB. אם לא בטוח — יוצר הסלמה</li>
        </List>
        <Note>
          הבוט בשלב Phase 1 — read-only. הוא <strong>לא</strong> מעדכן תגים ב-ManyChat ולא שולח הודעות. שליחת
          re-engagement היא פעולה נפרדת (כפתור ייעודי בעמוד הבית).
        </Note>
      </Card>

      <Card title="3 הכפתורים בעמוד הבית" eyebrow="פעולות ידניות">
        <Section title="1. הרץ בוט עכשיו">
          <P>
            מפעיל סבב סיווג מיידי, בלי לחכות לשעה הבאה. לוקח 15–60 שניות. אחרי זה רואים את הריצה ב-
            <Inline href="/dashboard/runs">היסטוריית ריצות</Inline>.
          </P>
          <P>
            <strong>מתי להשתמש:</strong> אחרי שהוספת לידים ידנית, או כשרוצים לבדוק שינוי בכללים מיד.
          </P>
        </Section>

        <Section title="2. שלח Re-engagement">
          <P>
            שולח template ב-WhatsApp לכל הלידים התקועים — כל אחד מקבל הודעה לפי הקטגוריה שלו (followup,
            after-holiday, price-too-high וכו&apos;).
          </P>
          <P>
            <strong>זה קורה אוטומטית כל יום ראשון בבוקר ב-11:00.</strong> הכפתור הידני נועד לחירום או למקרים
            שצריך להריץ שוב.
          </P>
          <Warning>
            פעולה בלתי-הפיכה. ManyChat ישלח הודעות אמיתיות. השתמש בזהירות.
          </Warning>
        </Section>

        <Section title="3. הוסף ליד ידני">
          <P>
            רושם subscriber חדש בטבלת leads. צריך את ה-subscriber_id מ-ManyChat (מספר ארוך).
          </P>
          <P>
            <strong>ברוב המקרים אין צורך</strong> — לידים נכנסים אוטומטית דרך ה-webhook של ManyChat. השתמש
            רק כשליד נופל בין הכיסאות.
          </P>
        </Section>
      </Card>

      <Card title="הסלמות" eyebrow="טיפול ידני">
        <P>
          הסלמה נוצרת כשהבוט לא בטוח מה לעשות. ב-
          <Inline href="/dashboard/escalations">דף ההסלמות</Inline> אפשר:
        </P>
        <List>
          <li>
            <strong>אשר ושלח</strong> — כותבים תגובה ושולחים. נסגר אוטומטית.
          </li>
          <li>
            <strong>דחה</strong> — סוגר את ההסלמה בלי לעשות כלום (היה false-positive).
          </li>
          <li>
            <strong>אטפל ידנית</strong> — סוגר את ההסלמה אבל מסמן שמטפלים מחוץ למערכת (טלפון, WhatsApp ידני).
          </li>
        </List>
        <P>
          סיבות הסלמה: <em>Claude לא בטוחה</em>, <em>ביקש שיחה אישית</em>, <em>נושא מחיר/הנחה</em>,{" "}
          <em>תלונה</em>, <em>לא מוכר/שבור</em>.
        </P>
      </Card>

      <Card title="עוד דפים" eyebrow="ניווט">
        <List>
          <li>
            <Inline href="/dashboard/pipeline">Pipeline</Inline> — תצוגת kanban של כל הלידים מקובצים לפי תג.
          </li>
          <li>
            <Inline href="/dashboard/runs">היסטוריית ריצות</Inline> — 50 הריצות האחרונות עם מטריקות.
          </li>
        </List>
      </Card>
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: fontStack.body,
        fontSize: size.md,
        color: colors.ink,
        lineHeight: leading.loose,
        margin: 0,
        marginBottom: space.md,
      }}
    >
      {children}
    </p>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return (
    <ul
      style={{
        fontFamily: fontStack.body,
        fontSize: size.md,
        color: colors.ink,
        lineHeight: leading.loose,
        paddingInlineStart: space.lg,
        marginTop: 0,
        marginBottom: space.md,
      }}
    >
      {children}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        paddingBlock: space.md,
        borderTop: `1px solid ${colors.ruleSoft}`,
      }}
    >
      <h3
        style={{
          fontFamily: fontStack.display,
          fontSize: size.lg,
          fontWeight: weight.medium,
          color: colors.ink,
          margin: 0,
          marginBottom: space.sm,
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: colors.surfaceMuted,
        borderInlineStart: `3px solid ${colors.inkSubtle}`,
        padding: space.md,
        borderRadius: radius.sm,
        fontFamily: fontStack.body,
        fontSize: size.sm,
        color: colors.inkMuted,
        lineHeight: leading.normal,
      }}
    >
      {children}
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: colors.dangerBg,
        borderInlineStart: `3px solid ${colors.danger}`,
        padding: space.md,
        borderRadius: radius.sm,
        fontFamily: fontStack.body,
        fontSize: size.sm,
        color: colors.danger,
        lineHeight: leading.normal,
        fontWeight: weight.medium,
      }}
    >
      {children}
    </div>
  );
}

function Inline({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      style={{
        color: colors.accent,
        textDecoration: "underline",
        textUnderlineOffset: 2,
      }}
    >
      {children}
    </a>
  );
}
