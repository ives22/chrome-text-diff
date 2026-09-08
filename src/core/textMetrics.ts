export function countTextLines(value: string): number {
  return value === "" ? 0 : value.replace(/\r\n?/gu, "\n").split("\n").length;
}
