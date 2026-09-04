import { describe, expect, it } from "vitest";
import {
  MAX_TEXT_BYTES,
  MAX_TEXT_LINES,
  computeDiff,
  createUnifiedPatch,
  validateText,
} from "../src/core/diffEngine";
import { DEFAULT_COMPARE_OPTIONS } from "../src/core/types";

describe("computeDiff", () => {
  it("returns unchanged aligned rows for identical text", () => {
    const result = computeDiff("alpha\nbeta", "alpha\nbeta", DEFAULT_COMPARE_OPTIONS);

    expect(result.stats).toEqual({ added: 0, removed: 0, unchanged: 2, hunks: 0 });
    expect(result.rows.map((row) => row.kind)).toEqual(["equal", "equal"]);
    expect(result.rows[1]?.left?.lineNumber).toBe(2);
    expect(result.rows[1]?.right?.lineNumber).toBe(2);
  });

  it("aligns replacement and addition rows inside one hunk", () => {
    const result = computeDiff("foo\nbar", "foo\nbaz\nqux", DEFAULT_COMPARE_OPTIONS);

    expect(result.stats).toEqual({ added: 2, removed: 1, unchanged: 1, hunks: 1 });
    expect(result.rows.map((row) => row.kind)).toEqual(["equal", "change", "add"]);
    expect(result.rows[1]?.left?.text).toBe("bar");
    expect(result.rows[1]?.right?.text).toBe("baz");
    expect(result.rows[2]?.left).toBeUndefined();
    expect(result.rows[2]?.right?.lineNumber).toBe(3);
  });

  it("normalizes CRLF and CR line endings", () => {
    const result = computeDiff("a\r\nb\rc", "a\nb\nc", DEFAULT_COMPARE_OPTIONS);

    expect(result.stats).toEqual({ added: 0, removed: 0, unchanged: 3, hunks: 0 });
  });

  it("supports case, whitespace, and blank-line ignore options", () => {
    const result = computeDiff("Alpha   beta\n\nGamma", "alpha beta\ngamma", {
      ...DEFAULT_COMPARE_OPTIONS,
      ignoreCase: true,
      ignoreWhitespace: true,
      ignoreBlankLines: true,
    });

    expect(result.stats).toEqual({ added: 0, removed: 0, unchanged: 2, hunks: 0 });
    expect(result.rows[0]?.left?.text).toBe("Alpha   beta");
    expect(result.rows[0]?.right?.text).toBe("alpha beta");
  });

  it("uses character segments for smart CJK changes", () => {
    const result = computeDiff("你好世界", "你好中国", DEFAULT_COMPARE_OPTIONS);
    const changed = result.rows[0];

    expect(changed?.kind).toBe("change");
    expect(changed?.left?.segments).toEqual([
      { type: "equal", value: "你好" },
      { type: "remove", value: "世界" },
    ]);
    expect(changed?.right?.segments).toEqual([
      { type: "equal", value: "你好" },
      { type: "add", value: "中国" },
    ]);
  });

  it("preserves a trailing newline as an empty added line", () => {
    const result = computeDiff("value", "value\n", DEFAULT_COMPARE_OPTIONS);

    expect(result.stats).toEqual({ added: 1, removed: 0, unchanged: 1, hunks: 1 });
    expect(result.rows.at(-1)?.right?.text).toBe("");
  });

  it("handles emoji without corrupting surrogate pairs", () => {
    const result = computeDiff("状态 😀", "状态 ✅", {
      ...DEFAULT_COMPARE_OPTIONS,
      granularity: "character",
    });

    expect(result.rows[0]?.left?.segments).toContainEqual({ type: "remove", value: "😀" });
    expect(result.rows[0]?.right?.segments).toContainEqual({ type: "add", value: "✅" });
  });
});

describe("validateText", () => {
  it("accepts the exact line limit and rejects one line above it", () => {
    const atLimit = Array.from({ length: MAX_TEXT_LINES }, () => "line").join("\n");
    const aboveLimit = `${atLimit}\nline`;

    expect(validateText(atLimit).valid).toBe(true);
    expect(validateText(aboveLimit)).toMatchObject({ valid: false, reason: "lines" });
  });

  it("rejects text larger than two UTF-8 megabytes", () => {
    const oversized = "a".repeat(MAX_TEXT_BYTES + 1);

    expect(validateText(oversized)).toMatchObject({ valid: false, reason: "bytes" });
  });
});

describe("createUnifiedPatch", () => {
  it("uses file labels and emits standard removal and addition lines", () => {
    const patch = createUnifiedPatch("before.txt", "after.txt", "alpha\nbeta", "alpha\ngamma");

    expect(patch).toContain("--- before.txt");
    expect(patch).toContain("+++ after.txt");
    expect(patch).toContain("-beta");
    expect(patch).toContain("+gamma");
  });
});
