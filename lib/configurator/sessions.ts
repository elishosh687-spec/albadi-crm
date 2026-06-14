/**
 * Short-lived configurator sessions — Eli sends a personalized link via WhatsApp;
 * the customer opens it and we pre-fill contact details from the linked lead.
 */

import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
import { buildConfiguratorSessionLink } from "./urls";

const SESSION_TTL_DAYS = 14;
let bootstrapped = false;

async function ensureTables(): Promise<void> {
  if (bootstrapped) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS configurator_sessions (
      token TEXT PRIMARY KEY,
      manychat_sub_id TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
      created_by TEXT DEFAULT 'eli'
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS configurator_sessions_sid_idx
      ON configurator_sessions (manychat_sub_id, created_at DESC)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS configurator_designs (
      id TEXT PRIMARY KEY,
      session_token TEXT,
      manychat_sub_id TEXT,
      product_id TEXT,
      quantity INTEGER,
      has_handles BOOLEAN,
      logo_colors INTEGER,
      has_lamination BOOLEAN,
      shipping_option_id TEXT,
      color_sku TEXT,
      color_hex TEXT,
      color_name TEXT,
      logo_file_name TEXT,
      logo_scale DOUBLE PRECISION,
      logo_position_x DOUBLE PRECISION,
      logo_position_y DOUBLE PRECISION,
      logo_rotation DOUBLE PRECISION,
      unit_price_ils DOUBLE PRECISION,
      total_order_ils DOUBLE PRECISION,
      customer_name TEXT,
      customer_email TEXT,
      customer_phone TEXT,
      notes TEXT,
      source TEXT DEFAULT 'customer',
      created_at TIMESTAMPTZ DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS configurator_designs_sid_idx
      ON configurator_designs (manychat_sub_id, created_at DESC)
  `);
  bootstrapped = true;
}

function newToken(): string {
  return randomBytes(18).toString("base64url");
}

export async function createConfiguratorSession(manychatSubId: string): Promise<{
  token: string;
  link: string;
  expiresAt: Date;
}> {
  await ensureTables();
  const sid = manychatSubId.trim();
  if (!sid) throw new Error("missing sid");

  const token = newToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_TTL_DAYS);

  await db.execute(sql`
    INSERT INTO configurator_sessions (token, manychat_sub_id, expires_at, created_by)
    VALUES (${token}, ${sid}, ${expiresAt.toISOString()}, 'eli')
  `);

  return { token, link: buildConfiguratorSessionLink(token), expiresAt };
}

export interface ConfiguratorSessionLead {
  manychatSubId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
}

export async function loadConfiguratorSession(
  token: string
): Promise<ConfiguratorSessionLead | null> {
  await ensureTables();
  const clean = token.trim();
  if (!clean) return null;

  const res = await db.execute(sql`
    SELECT s.manychat_sub_id AS "manychatSubId",
           l.name,
           l.phone_e164 AS phone,
           l.email
    FROM configurator_sessions s
    LEFT JOIN leads l ON trim(l.manychat_sub_id) = trim(s.manychat_sub_id)
    WHERE s.token = ${clean}
      AND s.expires_at > now()
    LIMIT 1
  `);
  const row = ((res as unknown as { rows?: Record<string, unknown>[] }).rows ?? [])[0];
  if (!row) return null;

  return {
    manychatSubId: String(row.manychatSubId),
    name: row.name ? String(row.name) : null,
    phone: row.phone ? String(row.phone) : null,
    email: row.email ? String(row.email) : null,
  };
}

export interface SaveConfiguratorDesignInput {
  sessionToken?: string | null;
  manychatSubId?: string | null;
  productId: string;
  quantity: number;
  hasHandles: boolean;
  logoColors: number;
  hasLamination: boolean;
  shippingOptionId: string;
  colorSku: string;
  colorHex: string;
  colorName: string;
  logoFileName?: string | null;
  logoScale: number;
  logoPositionX: number;
  logoPositionY: number;
  logoRotation: number;
  unitPriceIls: number;
  totalOrderIls: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  notes?: string | null;
  source?: "customer" | "crm_link" | "website";
}

export async function saveConfiguratorDesign(
  input: SaveConfiguratorDesignInput
): Promise<{ id: string; manychatSubId: string | null; leadCreated: boolean }> {
  await ensureTables();
  const id = randomBytes(12).toString("base64url");

  let sid = input.manychatSubId?.trim() || null;
  let leadCreated = false;

  if (!sid && input.sessionToken?.trim()) {
    const session = await loadConfiguratorSession(input.sessionToken.trim());
    sid = session?.manychatSubId ?? null;
  }

  // Website visitors: always resolve canonical lead by phone (handles 050 vs 972
  // and merges onto an existing ManyChat / WhatsApp row).
  if (
    input.customerPhone.trim() &&
    (!sid || input.source === "website")
  ) {
    const { upsertLeadFromConfigurator } = await import("./upsert-lead");
    const upserted = await upsertLeadFromConfigurator({
      name: input.customerName,
      email: input.customerEmail,
      phone: input.customerPhone,
      quoteTotalIls: input.totalOrderIls,
      colorName: input.colorName,
      quantity: input.quantity,
      notes: input.notes,
    });
    if (upserted) {
      sid = upserted.manychatSubId;
      leadCreated = upserted.created;
    }
  }

  await db.execute(sql`
    INSERT INTO configurator_designs (
      id, session_token, manychat_sub_id,
      product_id, quantity, has_handles, logo_colors, has_lamination, shipping_option_id,
      color_sku, color_hex, color_name, logo_file_name,
      logo_scale, logo_position_x, logo_position_y, logo_rotation,
      unit_price_ils, total_order_ils,
      customer_name, customer_email, customer_phone, notes, source
    ) VALUES (
      ${id},
      ${input.sessionToken?.trim() || null},
      ${sid},
      ${input.productId},
      ${input.quantity},
      ${input.hasHandles},
      ${input.logoColors},
      ${input.hasLamination},
      ${input.shippingOptionId},
      ${input.colorSku},
      ${input.colorHex},
      ${input.colorName},
      ${input.logoFileName ?? null},
      ${input.logoScale},
      ${input.logoPositionX},
      ${input.logoPositionY},
      ${input.logoRotation},
      ${input.unitPriceIls},
      ${input.totalOrderIls},
      ${input.customerName},
      ${input.customerEmail},
      ${input.customerPhone},
      ${input.notes ?? null},
      ${input.source ?? "customer"}
    )
  `);

  // Note append for CRM-link path only — website upsert already wrote notes.
  if (sid && input.source === "crm_link") {
    await db
      .update(leads)
      .set({
        notes: sql`COALESCE(${leads.notes}, '') || ${`\n\n[מעצב 3D ${new Date().toLocaleDateString("he-IL")}] ${input.colorName} · ${input.quantity} יח׳ · ₪${input.totalOrderIls.toFixed(0)}`}`,
      })
      .where(sql`trim(${leads.manychatSubId}) = ${sid}`);
  }

  return { id, manychatSubId: sid, leadCreated: leadCreated ?? false };
}

export interface ConfiguratorDesignRow {
  id: string;
  productId: string | null;
  quantity: number | null;
  colorName: string | null;
  colorHex: string | null;
  totalOrderIls: number | null;
  customerName: string | null;
  hasLamination: boolean | null;
  createdAt: string;
}

export async function loadConfiguratorDesignsForLead(
  manychatSubId: string,
  limit = 10
): Promise<ConfiguratorDesignRow[]> {
  await ensureTables();
  const sid = manychatSubId.trim();
  if (!sid) return [];

  const { israeliPhoneSuffix, normalizeIsraeliPhoneE164 } = await import(
    "@/lib/phone/israel"
  );

  const [leadRow] = await db
    .select({ phone: leads.phoneE164 })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid}`)
    .limit(1);

  const phoneSuffix = leadRow?.phone
    ? israeliPhoneSuffix(normalizeIsraeliPhoneE164(leadRow.phone) ?? leadRow.phone)
    : null;

  const res = await db.execute(sql`
    SELECT id,
           product_id AS "productId",
           quantity,
           color_name AS "colorName",
           color_hex AS "colorHex",
           total_order_ils AS "totalOrderIls",
           customer_name AS "customerName",
           has_lamination AS "hasLamination",
           created_at AS "createdAt"
    FROM configurator_designs
    WHERE trim(manychat_sub_id) = ${sid}
      ${
        phoneSuffix
          ? sql`OR right(regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g'), 9) = ${phoneSuffix}`
          : sql``
      }
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);

  const rows = ((res as unknown as { rows?: Record<string, unknown>[] }).rows ?? []);
  return rows.map((r) => ({
    id: String(r.id),
    productId: r.productId ? String(r.productId) : null,
    quantity: r.quantity != null ? Number(r.quantity) : null,
    colorName: r.colorName ? String(r.colorName) : null,
    colorHex: r.colorHex ? String(r.colorHex) : null,
    totalOrderIls: r.totalOrderIls != null ? Number(r.totalOrderIls) : null,
    customerName: r.customerName ? String(r.customerName) : null,
    hasLamination: r.hasLamination === true,
    createdAt: new Date(String(r.createdAt)).toISOString(),
  }));
}
