/**
 * Architecture rule — CLAUDE.md "Client-bundle import rule".
 *
 * A `"use client"` component must never reach, through any chain of STATIC
 * imports, a module that THROWS at load time without its env var:
 *   - lib/db.ts               (DATABASE_URL)
 *   - lib/manychat/config.ts  (MANYCHAT_TOKEN)
 * The bundler inlines the whole module into the browser bundle, module
 * evaluation throws, React unmounts the tree — and Vercel shows a 200 because
 * SSR was fine. Only the DevTools console knows. This test knows earlier.
 *
 * Pure node:fs — no bundler. Resolution mirrors what SWC would keep:
 *   - `import type` / `export type` / all-`type` specifier lists are elided
 *   - a `"use server"` module (server actions) becomes an RPC stub on the
 *     client, so traversal stops there — its imports never ship
 *   - bare packages are ignored; `@/x` → repo root; relative paths try
 *     .ts / .tsx / index.ts / index.tsx
 *   - a dynamic `import()` is NOT followed for the crash rule: it evaluates
 *     when called, not at load. It still ships the module into a browser
 *     chunk, so the known lazy chains are pinned in a second test.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const FORBIDDEN = ["lib/db.ts", "lib/manychat/config.ts"];
const SCAN_DIRS = ["app", "components"];
const EXTS = [".ts", ".tsx"];

/**
 * Modules that reach a forbidden file only through a dynamic `import()` —
 * deliberately lazy so their client-safe constants can be imported from
 * components. Not a load-time crash, but every entry here ships neon +
 * drizzle into a browser chunk. Exact-match: a new one fails, a removed one
 * must be pruned.
 */
const KNOWN_LAZY_EDGES = [
  // applyGhlPause() does `await import("@/lib/db")`; BotMapPanel imports
  // PAUSE_REASON_LABELS from the same file.
  "lib/autoresponder/bot-pause.ts",
];

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTS.some((e) => entry.name.endsWith(e)) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** The directive, if the file's first non-comment statement is one. */
function directiveOf(src: string): "use client" | "use server" | null {
  const stripped = src
    .replace(/^﻿/, "")
    .replace(/^(\s*(\/\*[\s\S]*?\*\/|\/\/[^\n]*\n?))*/, "")
    .trimStart();
  const m = /^["'](use client|use server)["']/.exec(stripped);
  return (m?.[1] as "use client" | "use server" | undefined) ?? null;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
}

/** Value-level STATIC import specifiers of a file (type-only imports elided). */
function importSpecifiers(src: string): string[] {
  const out: string[] = [];
  const code = stripComments(src);

  // import X from "s" | import {a, type b} from "s" | import "s" | import * as x from "s"
  const importRe = /\bimport\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;
  for (const m of code.matchAll(importRe)) {
    if (m[4]) {
      out.push(m[4]); // side-effect import
      continue;
    }
    if (m[1]) continue; // import type ...
    if (allSpecifiersAreTypes(m[2] ?? "")) continue;
    out.push(m[3]);
  }
  // export { a, type b } from "s" | export * from "s" | export type { .. } from "s"
  const exportRe = /\bexport\s+(type\s+)?(\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*["']([^"']+)["']/g;
  for (const m of code.matchAll(exportRe)) {
    if (m[1]) continue;
    if (m[2].startsWith("{") && allSpecifiersAreTypes(m[2])) continue;
    out.push(m[3]);
  }
  return out;
}

/** Dynamic `import("s")` specifiers — evaluated lazily, never at module load. */
function dynamicImportSpecifiers(src: string): string[] {
  return [...stripComments(src).matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
}

function allSpecifiersAreTypes(clause: string): boolean {
  const brace = /\{([^}]*)\}/.exec(clause);
  if (!brace) return false; // default / namespace import → value import
  const before = clause.slice(0, brace.index).replace(/,/g, "").trim();
  if (before) return false; // `import Def, { type X }` → Def is a value
  const names = brace[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return names.length > 0 && names.every((n) => /^type\s+/.test(n));
}

function resolve(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // bare package
  if (/\.(css|scss|json|svg|png|jpe?g|gif|webp|mp4|woff2?)$/.test(base)) return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")];
  for (const c of candidates) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}

const srcCache = new Map<string, string>();
function read(file: string): string {
  let s = srcCache.get(file);
  if (s === undefined) {
    s = fs.readFileSync(file, "utf8");
    srcCache.set(file, s);
  }
  return s;
}

const rel = (f: string) => path.relative(ROOT, f);

/** Every file statically reachable from a client entry (the entry included). */
function staticClosure(entry: string): Map<string, string[]> {
  const chains = new Map<string, string[]>();
  const stack: { file: string; chain: string[] }[] = [{ file: entry, chain: [entry] }];
  while (stack.length) {
    const { file, chain } = stack.pop()!;
    if (chains.has(file)) continue;
    chains.set(file, chain);
    const src = read(file);
    // Server actions are RPC stubs on the client — nothing below them ships.
    if (file !== entry && directiveOf(src) === "use server") continue;
    for (const spec of importSpecifiers(src)) {
      const target = resolve(file, spec);
      if (target && !chains.has(target)) stack.push({ file: target, chain: [...chain, target] });
    }
  }
  return chains;
}

describe("client bundle never reaches env-throwing modules", () => {
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  const clientFiles = files.filter((f) => directiveOf(read(f)) === "use client");
  const closures = new Map(clientFiles.map((f) => [f, staticClosure(f)] as const));

  it("sees the client tree (sanity: the scanner is not silently empty)", () => {
    expect(clientFiles.length).toBeGreaterThan(50);
    for (const f of FORBIDDEN) expect(fs.existsSync(path.join(ROOT, f)), `${f} moved? update FORBIDDEN`).toBe(true);
  });

  it("the resolver follows @/ and relative value imports and elides type-only ones", () => {
    const src = `
      import type { A } from "@/lib/db";
      import { type B, type C } from "./types";
      import Def, { type D } from "../x";
      import { sql } from "drizzle-orm";
      import "./side";
      export type { E } from "./e";
      export { f } from "./f";
      // import { g } from "./commented";
      const l = () => import("./lazy");
    `;
    expect(importSpecifiers(src)).toEqual(["../x", "drizzle-orm", "./side", "./f"]);
    expect(dynamicImportSpecifiers(src)).toEqual(["./lazy"]);
    expect(directiveOf(`// c\n/* d */\n"use client";\nimport x from "y";`)).toBe("use client");
    expect(directiveOf(`import x from "y";\n"use client";`)).toBeNull();
  });

  it("no 'use client' file statically imports lib/db.ts or lib/manychat/config.ts (transitively)", () => {
    const violations: string[] = [];
    for (const [, chains] of closures) {
      for (const [file, chain] of chains) {
        if (FORBIDDEN.includes(rel(file))) violations.push(chain.map(rel).join("\n    → "));
      }
    }
    expect(
      violations,
      `client components reaching an env-throwing module (the browser bundle will crash at load):\n\n${violations.join("\n\n")}`,
    ).toEqual([]);
  });

  it("dynamic import() paths from the client tree to a forbidden module are exactly the known ones", () => {
    // Not a load-time crash (lazy), but it puts the DB driver in a browser
    // chunk. Pinned so the list can only change on purpose.
    const lazyEdges = new Set<string>();
    for (const [, chains] of closures) {
      for (const [file] of chains) {
        for (const spec of dynamicImportSpecifiers(read(file))) {
          const target = resolve(file, spec);
          if (target && FORBIDDEN.includes(rel(target))) lazyEdges.add(rel(file));
        }
      }
    }
    expect([...lazyEdges].sort()).toEqual([...KNOWN_LAZY_EDGES].sort());
  });
});
