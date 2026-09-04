import { PENDING_COMPARE_KEY } from "../core/storage";
import type { PendingCompare } from "./messages";

export async function consumePendingCompare(): Promise<PendingCompare | null> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return null;

  const stored = await chrome.storage.local.get(PENDING_COMPARE_KEY);
  const pending = stored[PENDING_COMPARE_KEY];
  if (!isPendingCompare(pending)) return null;
  await chrome.storage.local.remove(PENDING_COMPARE_KEY);
  return pending;
}

function isPendingCompare(value: unknown): value is PendingCompare {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PendingCompare>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.leftText === "string" &&
    typeof candidate.rightText === "string" &&
    typeof candidate.leftName === "string" &&
    typeof candidate.rightName === "string" &&
    typeof candidate.autoCompare === "boolean"
  );
}
