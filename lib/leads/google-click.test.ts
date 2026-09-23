/**
 * lib/leads/google-click.ts — the Google click columns a website lead carries,
 * and reading the old `gclid: …` note back for the backfill (2026-09-23).
 */
import { describe, expect, it } from "vitest";
import { googleClickColumns, parseClickFromNotes } from "./google-click";

const GCLID = "Cj0KCQjw-TEST_gclid.123";

describe("googleClickColumns", () => {
  it("stores every field, trimmed", () => {
    const c = googleClickColumns({
      gclid: ` ${GCLID} `,
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "albadi-search-nonbrand",
      utmTerm: "שקיות אלבד",
      utmContent: "187654321",
      landingUrl: "https://albadisael.com/calculator?gclid=x",
    });
    expect(c.googleGclid).toBe(GCLID);
    expect(c.utmTerm).toBe("שקיות אלבד");
    expect(c.utmContent).toBe("187654321");
    expect(c.landingUrl).toBe("https://albadisael.com/calculator?gclid=x");
    expect(c.googleGbraid).toBeNull();
  });

  it("empty and blank values become null", () => {
    const c = googleClickColumns({ gclid: "  ", utmSource: "" });
    expect(Object.values(c).every((v) => v === null)).toBe(true);
  });

  it("rejects something that is not a click id", () => {
    expect(googleClickColumns({ gclid: "not a click id" }).googleGclid).toBeNull();
    expect(googleClickColumns({ gclid: "short" }).googleGclid).toBeNull();
  });

  it("keeps gbraid / wbraid apart from gclid", () => {
    const c = googleClickColumns({ gbraid: "0AAAAAgbraid123", wbraid: "CjkKwbraid4567" });
    expect(c.googleGclid).toBeNull();
    expect(c.googleGbraid).toBe("0AAAAAgbraid123");
    expect(c.googleWbraid).toBe("CjkKwbraid4567");
  });

  it("caps long text", () => {
    expect(googleClickColumns({ utmTerm: "א".repeat(900) }).utmTerm).toHaveLength(500);
  });
});

describe("parseClickFromNotes", () => {
  const block = (id: string, url?: string) =>
    ["📥 ליד מהאתר", "קמפיין: albadi-search-nonbrand · google · cpc", `gclid: ${id}`, ...(url ? [`דף נחיתה: ${url}`] : [])].join("\n");

  it("reads the gclid the old code wrote", () => {
    expect(parseClickFromNotes(block(GCLID, "https://albadi.ecobrotherss.com/?gclid=" + GCLID))).toEqual({
      gclid: GCLID,
      gbraid: null,
      wbraid: null,
      landingUrl: "https://albadi.ecobrotherss.com/?gclid=" + GCLID,
    });
  });

  it("the newest block wins when a lead has several", () => {
    const notes = `${block("Cj0OLDOLDOLD123")}\n\nbot note\n\n${block(GCLID)}`;
    expect(parseClickFromNotes(notes).gclid).toBe(GCLID);
  });

  it("a gbraid written under the gclid label is recognised from the landing URL", () => {
    const id = "0AAAAAgbraid123";
    const r = parseClickFromNotes(block(id, `https://albadisael.com/?gbraid=${id}`));
    expect(r.gclid).toBeNull();
    expect(r.gbraid).toBe(id);
  });

  it("organic website lead and empty notes → nothing", () => {
    expect(parseClickFromNotes("📥 ליד מהאתר\nללא click ID (תנועה אורגנית)").gclid).toBeNull();
    expect(parseClickFromNotes(null).gclid).toBeNull();
  });

  it("does not pick up a gclid mentioned mid-sentence", () => {
    expect(parseClickFromNotes(`Eli: the gclid: ${GCLID} looked odd`).gclid).toBeNull();
  });
});
