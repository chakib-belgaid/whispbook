import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings, speedToLengthScale } from "./settings";

describe("reader settings", () => {
  it("maps playback speed to Piper length scale", () => {
    expect(speedToLengthScale(1)).toBe(1);
    expect(speedToLengthScale(2)).toBe(0.5);
    expect(speedToLengthScale(0.5)).toBe(1.667);
  });

  it("normalizes persisted settings", () => {
    expect(normalizeSettings({ quality: "high", speed: 9, volume: -1 })).toEqual({
      ...DEFAULT_SETTINGS,
      quality: "high",
      speed: 2,
      volume: 0
    });
  });
});
