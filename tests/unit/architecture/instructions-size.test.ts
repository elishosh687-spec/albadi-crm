/**
 * Architecture rule — AGENTS.md hard rule 13 "Keep instructions small".
 *
 * AGENTS.md + CLAUDE.md load into EVERY agent session. On 2026-09-18 CLAUDE.md
 * had grown to 145KB (~61k tokens per message) because each incident was
 * appended as a paragraph. It was split into docs/agent/*.md, loaded on demand.
 * This test keeps the always-loaded core from regrowing, and keeps every
 * .claude/rules symlink pointing at a real, path-scoped topic file.
 */
import { describe, expect, it } from "vitest";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
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

  it("every docs/agent topic is in the AGENTS.md index and has a path-scoped rule", () => {
    const index = read("AGENTS.md");
    const topics = readdirSync(join(ROOT, "docs/agent")).filter((f) => f.endsWith(".md"));
    expect(topics.length).toBeGreaterThan(0);
    for (const t of topics) {
      expect(index, `${t} missing from AGENTS.md index`).toContain("`" + t + "`");
      expect(read(`docs/agent/${t}`).startsWith("---\npaths:"), `${t} lacks paths frontmatter`).toBe(true);
      const link = join(ROOT, ".claude/rules", t);
      expect(existsSync(link) && lstatSync(link).isSymbolicLink(), `.claude/rules/${t} symlink`).toBe(true);
      expect(realpathSync(link)).toBe(realpathSync(join(ROOT, "docs/agent", t)));
    }
  });
});
