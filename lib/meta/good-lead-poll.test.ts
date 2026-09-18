import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/ghl/client", () => ({
  searchContactsByTag: vi.fn(async () => {
    throw new Error("GHL_LOCATION_ID is not set");
  }),
}));

import { pollGoodLeads } from "./good-lead-poll";

describe("pollGoodLeads", () => {
  it("regression 18/09: a dead GHL connection throws instead of reporting 'nobody tagged'", async () => {
    await expect(pollGoodLeads({ dry: true })).rejects.toThrow("GHL_LOCATION_ID");
  });
});
