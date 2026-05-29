import { describe, it, expect } from "vitest";
import { detectProviders, isCommandAvailable } from "../../src/providers/detect.js";

describe("isCommandAvailable", () => {
  it("returns true for commands that exist (node)", async () => {
    const result = await isCommandAvailable("node", ["--version"]);
    expect(result).toBe(true);
  });

  it("returns false for commands that don't exist", async () => {
    const result = await isCommandAvailable("definitely-not-a-real-command-xyz123", ["--version"]);
    expect(result).toBe(false);
  });
});

describe("detectProviders", () => {
  it("always reports core as true", async () => {
    const status = await detectProviders();
    expect(status.core).toBe(true);
  });
});
