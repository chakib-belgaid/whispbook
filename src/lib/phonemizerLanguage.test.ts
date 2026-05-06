import { describe, expect, it } from "vitest";
import { buildPhonemizerCandidates, pickPhonemizerLanguage } from "./phonemizerLanguage";

describe("phonemizer language normalization", () => {
  it("accepts Piper underscore language identifiers", () => {
    expect(buildPhonemizerCandidates("en_US")).toContain("en-us");
  });

  it("falls back to a valid English identifier", () => {
    const identifiers = new Set(["en", "en-us", "gmw/en-US"]);

    expect(pickPhonemizerLanguage("en_US", identifiers)).toBe("en-us");
    expect(pickPhonemizerLanguage("unknown", identifiers)).toBe("en-us");
  });

  it("does not leak object values into phonemizer", () => {
    const identifiers = new Set(["en-us", "gmw/en-US"]);

    expect(pickPhonemizerLanguage({ voice: "en_US" }, identifiers)).toBe("en-us");
    expect(pickPhonemizerLanguage({ unexpected: "en_US" }, identifiers)).toBe("en-us");
  });
});
