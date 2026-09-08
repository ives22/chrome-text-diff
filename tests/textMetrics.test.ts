import { describe, expect, it } from "vitest";
import { countTextLines } from "../src/core/textMetrics";

describe("countTextLines", () => {
  it("uses the same line count for LF, CRLF, empty text, and trailing newlines", () => {
    expect(countTextLines("")).toBe(0);
    expect(countTextLines("alpha")).toBe(1);
    expect(countTextLines("alpha\nbeta")).toBe(2);
    expect(countTextLines("alpha\r\nbeta")).toBe(2);
    expect(countTextLines("alpha\n")).toBe(2);
  });
});
