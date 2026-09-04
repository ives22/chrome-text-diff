export type ExtensionMessage =
  | { type: "OPEN_WORKBENCH" }
  | { type: "SET_ORIGINAL_SELECTION"; text: string }
  | { type: "COMPARE_SELECTION"; text: string }
  | { type: "PENDING_COMPARE_READY" };

export interface PendingOriginal {
  schemaVersion: 1;
  text: string;
  updatedAt: string;
}

export interface PendingCompare {
  schemaVersion: 1;
  leftText: string;
  rightText: string;
  leftName: string;
  rightName: string;
  autoCompare: boolean;
  createdAt: string;
}
