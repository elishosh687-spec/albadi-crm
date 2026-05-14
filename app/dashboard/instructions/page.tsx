import { Page } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { colors, fontStack, leading, radius, size, space, weight } from "@/lib/ui/tokens";
import { V2Chrome } from "../_components/V2Chrome";

export default function InstructionsPage() {
  return (
    <V2Chrome>
    <div>
      <Page
        eyebrow="מדריך שימוש"
        title="איך עובד Albadi v2"
        description="הזרימה החדשה: webhook → Claude → דאשבורד → אישור → ManyChat."
      />

      <Card title="מה הבוט עושה" eyebrow="סקירה">
        <P>
          הבוט קורא את כל הלידים הפעילים פעם בשעה, קורא את ה-WhatsApp ואת ה-notes שלך,
          ומציע סיווג ל-<Code>pipeline_stage</Code>, flags, פעולה הבאה, וסיכום קצר. אתה רואה
          את ההצעות בדאשבורד ומאשר/דוחה/משנה. אישור = push ל-ManyChat.
        </P>
      </Card>

      <Card title="הזרימה" eyebrow="step by step">
        <List>
          <li>
            <Strong>1. ManyChat → DB:</Strong> כל הודעת WhatsApp נכנסת או יוצאת מופעלת ע&quot;י
            External Request ב-Default Reply Flow ונשמרת בטבלת <Code>messages</Code>.
          </li>
          <li>
            <Strong>2. Skill מקומי:</Strong> אצלך ב-Claude Code פתוח <Code>/loop 1h /albadi-classify</Code>.
            כל שעה הסקיל קורא ל-<Code>/api/bot/queue-analysis</Code> כדי להוסיף לתור לידים שצריך
            לסווג.
          </li>
          <li>
            <Strong>3. Claude מנתח:</Strong> שולף 20 לידים בכל פעם דרך <Code>/api/bot/claude-context</Code>
            עם כל הקונטקסט (custom fields, הודעות 60 יום, החלטות קודמות שלך), ומחזיר עבור
            כל אחד: stage, flags, next_action, bot_summary, reason.
          </li>
          <li>
            <Strong>4. דאשבורד:</Strong> ההצעות מופיעות ב-Inbox. סדר: דחופים קודם, ואז סכום
            ההצעה. כל שורה כוללת הסבר מלא בעברית.
          </li>
          <li>
            <Strong>5. אישור / שינוי / דחיה:</Strong>
            <ul>
              <li><Strong>אישור:</Strong> Claude צודק → push ל-ManyChat (pipeline_stage + flags + next_action + bot_summary).</li>
              <li><Strong>שינוי:</Strong> תבחר stage/flags אחרים, רושם תיעוד ב-<Code>eli_decisions</Code>.</li>
              <li><Strong>דחה:</Strong> ההצעה תיגרס. בריצה הבאה הליד יחזור לתור עם הקונטקסט החדש.</li>
            </ul>
          </li>
          <li>
            <Strong>6. אישור הכל:</Strong> בסרגל ה-Inbox יש כפתור שמאשר את כל ה-checked rows
            בלחיצה אחת.
          </li>
        </List>
      </Card>

      <Card title="9 ערכי pipeline_stage" eyebrow="המצבים האפשריים">
        <Table>
          <thead>
            <tr><th>stage</th><th>מתי</th></tr>
          </thead>
          <tbody>
            <Row k="NEW" v="נרשם <7 ימים, אין שאלון, אין quote" />
            <Row k="QUESTIONNAIRE" v="חלק משאלון מולא, אין quote_total" />
            <Row k="QUOTED" v="quote_total > 0, אין סימני משא ומתן" />
            <Row k="NEGOTIATING" v="quote + מילים יקר/הנחה/להוריד" />
            <Row k="WAITING_CALL" v="ביקש שיחה ולא דיברנו" />
            <Row k="IN_PROGRESS" v="אחרי שיחה + notes מאשר/ממתין/עיצוב" />
            <Row k="WON" v="תשלום / סגרנו / הזמנתי" />
            <Row k="SILENT" v="last_interaction >5 ימים, אין תגובה" />
            <Row k="DROPPED" v="לא מעוניין/תפסיק; או 60+ ימי שתיקה" />
          </tbody>
        </Table>
      </Card>

      <Card title="5 flags" eyebrow="תגיות בוליאניות (כמה במקביל)">
        <Table>
          <thead>
            <tr><th>flag</th><th>מתי</th></tr>
          </thead>
          <tbody>
            <Row k="דחוף" v="WAITING_CALL >3 ימים, NEGOTIATING >7 ימים, או כעס/אכזבה ב-WhatsApp" />
            <Row k="עסקה_גדולה" v="quote_total ≥ 10,000 ₪" />
            <Row k="ביקש_שיחה" v="לחץ תיאום שיחה / רוצה לדבר עם סוכן" />
            <Row k="אחרי_החג" v="ה-notes שלך מציין &quot;אחרי החג&quot;" />
            <Row k="מועדף" v="ידני בלבד — אתה מסמן" />
          </tbody>
        </Table>
      </Card>

      <Card title="מה צריך לוודא שעובד" eyebrow="checklist">
        <List>
          <li>
            <Strong>ManyChat External Request:</Strong> ב-Default Reply Flow → POST ל-
            <Code>/api/bot/inbound-message</Code> עם header <Code>x-webhook-secret</Code> ו-body
            JSON עם <Code>{`{{user_id}}`}</Code> ו-<Code>{`{{last_input_text}}`}</Code>.
          </li>
          <li>
            <Strong>Claude Code:</Strong> session פתוח אצלך עם <Code>/loop 1h /albadi-classify</Code>
            (או הרצה ידנית כשנוח).
          </li>
          <li>
            <Strong>סודות:</Strong> <Code>BOT_SECRET</Code> ו-<Code>MANYCHAT_WEBHOOK_SECRET</Code> מוגדרים
            ב-Vercel env וב-<Code>.env</Code> מקומי.
          </li>
        </List>
      </Card>

      <Card title="טבלאות DB" eyebrow="מה נשמר איפה">
        <Table>
          <thead>
            <tr><th>טבלה</th><th>תוכן</th></tr>
          </thead>
          <tbody>
            <Row k="leads" v="כל הלידים הפעילים — sub_id, name, active" />
            <Row k="messages" v="היסטוריית WhatsApp (כניסה ויציאה)" />
            <Row k="analysis_queue" v="לידים שצריכים ניתוח (pending/analyzing/analyzed)" />
            <Row k="pipeline_suggestions" v="הצעות Claude לפני/אחרי אישור" />
            <Row k="eli_decisions" v="לוג כל אישור/override/דחיה — מקור לזיהוי patterns בעתיד" />
          </tbody>
        </Table>
      </Card>

      <Card title="הוספת חוקים בעתיד" eyebrow="phase 5">
        <P>
          אחרי ~150 שורות ב-<Code>eli_decisions</Code>, נוכל לזהות מקרים שאתה תמיד מאשר את
          ההצעה של Claude. את אלה נמיר לחוקים דטרמיניסטיים (ב-<Code>lib/classify/rules.ts</Code>) —
          יורידו את העומס מ-Claude למקרים פשוטים, ישאירו רק את האמביגואליים אצלו.
        </P>
      </Card>
    </div>
    </V2Chrome>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: fontStack.body,
        fontSize: size.md,
        color: colors.ink,
        lineHeight: leading.normal,
        marginTop: 0,
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
        lineHeight: leading.normal,
        paddingInlineStart: space.xl,
        marginTop: 0,
        marginBottom: space.lg,
      }}
    >
      {children}
    </ul>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <strong style={{ fontWeight: weight.semibold }}>{children}</strong>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        background: colors.surfaceMuted,
        borderRadius: radius.sm,
        padding: `1px ${space.xs}px`,
        fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace',
        fontSize: size.sm,
      }}
    >
      {children}
    </code>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontFamily: fontStack.body,
        fontSize: size.sm,
        marginBottom: space.md,
      }}
    >
      {children}
    </table>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <tr style={{ borderTop: `1px solid ${colors.ruleSoft}` }}>
      <td style={{ padding: `${space.sm}px ${space.md}px`, fontWeight: weight.medium, whiteSpace: "nowrap", color: colors.ink }}>
        {k}
      </td>
      <td style={{ padding: `${space.sm}px ${space.md}px`, color: colors.inkMuted }}>{v}</td>
    </tr>
  );
}
