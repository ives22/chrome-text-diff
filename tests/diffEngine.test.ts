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

    expect(result.stats).toEqual({
      addedUnits: 0,
      removedUnits: 0,
      addedLines: 0,
      removedLines: 0,
      unchangedLines: 2,
      hunks: 0,
    });
    expect(result.rows.map((row) => row.kind)).toEqual(["equal", "equal"]);
    expect(result.rows[1]?.left?.lineNumber).toBe(2);
    expect(result.rows[1]?.right?.lineNumber).toBe(2);
  });

  it("aligns replacement and addition rows inside one hunk", () => {
    const result = computeDiff("foo\nbar", "foo\nbaz\nqux", DEFAULT_COMPARE_OPTIONS);

    expect(result.stats).toEqual({
      addedUnits: 2,
      removedUnits: 1,
      addedLines: 2,
      removedLines: 1,
      unchangedLines: 1,
      hunks: 1,
    });
    expect(result.rows.map((row) => row.kind)).toEqual(["equal", "change", "add"]);
    expect(result.rows[1]?.left?.text).toBe("bar");
    expect(result.rows[1]?.right?.text).toBe("baz");
    expect(result.rows[2]?.left).toBeUndefined();
    expect(result.rows[2]?.right?.lineNumber).toBe(3);
  });

  it("normalizes CRLF and CR line endings", () => {
    const result = computeDiff("a\r\nb\rc", "a\nb\nc", DEFAULT_COMPARE_OPTIONS);

    expect(result.stats).toMatchObject({
      addedUnits: 0,
      removedUnits: 0,
      addedLines: 0,
      removedLines: 0,
      unchangedLines: 3,
      hunks: 0,
    });
  });

  it("supports case, whitespace, and blank-line ignore options", () => {
    const result = computeDiff("Alpha   beta\n\nGamma", "alpha beta\ngamma", {
      ...DEFAULT_COMPARE_OPTIONS,
      ignoreCase: true,
      ignoreWhitespace: true,
      ignoreBlankLines: true,
    });

    expect(result.stats).toMatchObject({
      addedUnits: 0,
      removedUnits: 0,
      addedLines: 0,
      removedLines: 0,
      unchangedLines: 2,
      hunks: 0,
    });
    expect(result.rows[0]?.left?.text).toBe("Alpha   beta");
    expect(result.rows[0]?.right?.text).toBe("alpha beta");
  });

  it("does not highlight casing inside a line that has another real change", () => {
    const result = computeDiff("Name: Foo old", "name: foo new", {
      ...DEFAULT_COMPARE_OPTIONS,
      ignoreCase: true,
    });

    expect(changedValues(result.rows[0]?.left?.segments, "remove")).toEqual(["old"]);
    expect(changedValues(result.rows[0]?.right?.segments, "add")).toEqual(["new"]);
    expect(result.stats).toMatchObject({ removedUnits: 1, addedUnits: 1 });
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

    expect(result.stats).toMatchObject({
      addedUnits: 1,
      removedUnits: 0,
      addedLines: 1,
      removedLines: 0,
      unchangedLines: 1,
      hunks: 1,
    });
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

  it("compares twenty thousand configuration lines within the performance budget", () => {
    const leftLines = Array.from(
      { length: MAX_TEXT_LINES },
      (_, index) => `service-${index}: image=registry.example.com/app:${index} replicas=2`,
    );
    const rightLines = leftLines.map((line, index) =>
      index % 1_000 === 0 ? line.replace("replicas=2", "replicas=3") : line,
    );
    const startedAt = performance.now();

    const result = computeDiff(
      leftLines.join("\n"),
      rightLines.join("\n"),
      DEFAULT_COMPARE_OPTIONS,
    );

    expect(performance.now() - startedAt).toBeLessThan(3_000);
    expect(result.stats).toMatchObject({
      addedUnits: 20,
      removedUnits: 20,
      addedLines: 20,
      removedLines: 20,
      hunks: 20,
    });
  }, 8_000);

  it("compares an uneven annotation block as one presentable change", () => {
    const left = [
      '    deployment.example.io/revision: "44"',
      "    change-cause: set image Deployment/data-center data-center=registry.example.com/example/data-center:def7a8d-09041720-dev",
    ].join("\n");
    const right =
      "    change-cause: set image StatefulSet/identity-center identity-center=registry.example.com/example/identity-center:b8a12dc-09041718-dev";

    const result = computeDiff(left, right, DEFAULT_COMPARE_OPTIONS);

    expect(result.stats).toMatchObject({
      removedUnits: 7,
      addedUnits: 5,
      removedLines: 2,
      addedLines: 1,
      unchangedLines: 0,
      hunks: 1,
    });
    expect(changedValues(result.rows[1]?.left?.segments, "remove")).toEqual([
      "",
      "Deployment/data",
      "data",
      "data",
      "def7a8d",
      "20",
    ]);
    expect(changedValues(result.rows[0]?.right?.segments, "add")).toEqual([
      "StatefulSet/identity",
      "identity",
      "identity",
      "b8a12dc",
      "18",
    ]);
  });

  it("preserves shared image path and version prefix inside one changed line", () => {
    const left =
      "        image: registry.example.com/example/data-center:def7a8d-09041720-dev";
    const right =
      "        image: registry.example.com/example/identity-center:b8a12dc-09041718-dev";

    const result = computeDiff(left, right, DEFAULT_COMPARE_OPTIONS);

    expect(result.stats).toMatchObject({
      removedUnits: 3,
      addedUnits: 3,
      removedLines: 1,
      addedLines: 1,
    });
    expect(changedValues(result.rows[0]?.left?.segments, "remove")).toEqual([
      "data",
      "def7a8d",
      "20",
    ]);
    expect(changedValues(result.rows[0]?.right?.segments, "add")).toEqual([
      "identity",
      "b8a12dc",
      "18",
    ]);
  });

  it("uses whole-line segments for a low-similarity replacement block", () => {
    const left = Array.from({ length: 8 }, (_, index) => `left-${index}-deployment-setting`)
      .join("\n");
    const right = Array.from({ length: 3 }, (_, index) => `right-${index}-stateful-policy`)
      .join("\n");

    const result = computeDiff(left, right, DEFAULT_COMPARE_OPTIONS);

    expect(result.stats).toMatchObject({
      removedUnits: 8,
      addedUnits: 3,
      removedLines: 8,
      addedLines: 3,
    });
    for (const row of result.rows) {
      if (row.left) expect(changedValues(row.left.segments, "remove")).toEqual([row.left.text]);
      if (row.right) expect(changedValues(row.right.segments, "add")).toEqual([row.right.text]);
    }
  });

  it("matches the sanitized Kubernetes reference statistics", () => {
    const { left, right } = createSanitizedReferenceFixture();

    const result = computeDiff(left, right, DEFAULT_COMPARE_OPTIONS);

    expect(result.stats).toEqual({
      removedUnits: 57,
      addedUnits: 67,
      removedLines: 50,
      addedLines: 61,
      unchangedLines: 74,
      hunks: 22,
    });
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

function changedValues(
  segments: Array<{ type: "equal" | "add" | "remove"; value: string }> | undefined,
  type: "add" | "remove",
): string[] {
  return segments?.filter((segment) => segment.type === type).map((segment) => segment.value) ?? [];
}

function createSanitizedReferenceFixture(): { left: string; right: string } {
  const removedLines = new Set([
    2, 5, 6, 8, 10, 11, 13, 15, 17, 18, 20, 21, 25, 26, 27, 28, 29, 30,
    33, 34, 36, 37, 41, 54, 66, 72, 74, 83, 103, 104, 105, 106, 107, 108,
    109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122,
    123, 124,
  ]);
  const addedLines = new Set([
    2, 5, 7, 9, 10, 12, 14, 16, 17, 19, 20, 21, 22, 23, 27, 28, 32, 33,
    37, 48, 49, 50, 51, 52, 55, 67, 73, 75, 84, 91, 92, 93, 100, 101, 102,
    103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 122,
    123, 124, 125, 127, 128, 129, 130, 131, 132, 133, 134, 135,
  ]);
  let leftSharedIndex = 0;
  let rightSharedIndex = 0;
  const specialLeft: Record<number, string> = {
    5: '    deployment.example.io/revision: "44"',
    6: "    change-cause: set image Deployment/data-center data-center=registry.example.com/example/data-center:def7a8d-09041720-dev",
    54: "        image: registry.example.com/example/data-center:def7a8d-09041720-dev",
  };
  const specialRight: Record<number, string> = {
    5: "    change-cause: set image StatefulSet/identity-center identity-center=registry.example.com/example/identity-center:b8a12dc-09041718-dev",
    55: "        image: registry.example.com/example/identity-center:b8a12dc-09041718-dev",
  };
  const left = Array.from({ length: 124 }, (_, index) => {
    const lineNumber = index + 1;
    if (removedLines.has(lineNumber)) {
      return specialLeft[lineNumber] ?? `L${lineNumber.toString(36)}${"x".repeat(32)}`;
    }
    leftSharedIndex += 1;
    return `shared-line-${leftSharedIndex}`;
  });
  const right = Array.from({ length: 135 }, (_, index) => {
    const lineNumber = index + 1;
    if (addedLines.has(lineNumber)) {
      return specialRight[lineNumber] ?? `R${lineNumber.toString(36)}${"z".repeat(32)}`;
    }
    rightSharedIndex += 1;
    return `shared-line-${rightSharedIndex}`;
  });

  return { left: left.join("\n"), right: right.join("\n") };
}

describe("createUnifiedPatch", () => {
  it("uses file labels and emits standard removal and addition lines", () => {
    const patch = createUnifiedPatch("before.txt", "after.txt", "alpha\nbeta", "alpha\ngamma");

    expect(patch).toContain("--- before.txt");
    expect(patch).toContain("+++ after.txt");
    expect(patch).toContain("-beta");
    expect(patch).toContain("+gamma");
  });
});
