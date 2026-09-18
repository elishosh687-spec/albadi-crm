/**
 * Architecture rule — AGENTS.md hard rule 13 "Keep instructions small".
 *
 * AGENTS.md + CLAUDE.md load into EVERY agent session. On 2026-09-18 CLAUDE.md
 * had grown to 145KB (~61k tokens per message) because each incident was
 * appended as a paragraph. It was split into docs/agent/*.md, loaded on demand.
 * This test keeps the always-loaded core from regrowing, and keeps each
 * .claude/rules file a short digest that points at its full docs/agent file.
 */
import { describe, expect, it } from "vitest";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

describe("always-loaded agent instructions stay small", () => {
  it("AGENTS.md + CLAUDE.md are under 200 lines and 8KB together", () => {
    const text = read("AGENTS.md") + read("CLAUDE.md");
    expect(text.split("\n").length).toBeLessThan(200);
    expect(Buffer.byteLength(text, "utf8")).toBeLessThan(8 * 1024);
  });

  it("CLAUDE.md imports AGENTS.md (one shared source for Claude and Codex)", () => {
    expect(read("CLAUDE.md").split("\n")[0].trim()).toBe("@AGENTS.md");
  });

  it("every docs/agent topic is indexed and has a short path-scoped rule digest", () => {
    const index = read("AGENTS.md");
    const topics = readdirSync(join(ROOT, "docs/agent")).filter((f) => f.endsWith(".md"));
    expect(topics.length).toBeGreaterThan(0);
    for (const t of topics) {
      expect(index, `${t} missing from AGENTS.md index`).toContain("`" + t + "`");
      const rulePath = join(ROOT, ".claude/rules", t);
      expect(existsSync(rulePath), `.claude/rules/${t} missing`).toBe(true);
      expect(lstatSync(rulePath).isSymbolicLink(), `${t}: rule must be a digest, not a symlink to the full doc`).toBe(false);
      const rule = readFileSync(rulePath, "utf8");
      expect(rule.startsWith("---\npaths:"), `${t} rule lacks paths frontmatter`).toBe(true);
      expect(rule, `${t} rule must point at its full doc`).toContain(`docs/agent/${t}`);
      expect(rule, `${t} digest not written`).not.toContain("DIGEST PENDING");
      // A digest, not the doc: path rules load whole whenever a matching file is read.
      expect(Buffer.byteLength(rule, "utf8"), `${t} rule is too long for a digest`).toBeLessThan(4 * 1024);
    }
  });
});
