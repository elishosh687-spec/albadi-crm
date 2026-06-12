/**
 * POST /api/factory/finalize/[id]
 *
 * Body: { profitMarginOverride?, shippingOptionId? }
 *
 * Loads the request, runs priceFactoryQuote against the factory's response +
 * Eli's chosen margin / shipping option, generates a customer-facing PDF, and
 * persists everything. Sets status='finalized'.
 *
 * Auth: dashboard cookie (middleware).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { finalizeQuote } from "@/lib/factory/server/finalize";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  profitMarginOverride: z.number().min(0).max(99.9).optional(),
  shippingOptionId: z.string().optional(),
  moldsCostCny: z.number().min(0).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json().catch(() => ({})));
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", detail: String(err) },
      { status: 400 }
    );
  }

  const result = await finalizeQuote(id, body, req.headers.get("host"));
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.message ? { message: result.message } : {}) },
      { status: result.status }
    );
  }
  return NextResponse.json(result);
}
