/// <reference lib="webworker" />

import { computeDiff } from "../core/diffEngine";
import type { WorkerRequest, WorkerResponse } from "../core/diffWorkerClient";

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;
const cancelledRequests = new Set<string>();

workerScope.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === "CANCEL") {
    cancelledRequests.add(request.requestId);
    return;
  }

  if (cancelledRequests.has(request.requestId)) return;

  try {
    const result = computeDiff(request.leftText, request.rightText, request.options);
    if (cancelledRequests.has(request.requestId)) return;
    post({ type: "RESULT", requestId: request.requestId, result });
  } catch (error) {
    post({
      type: "ERROR",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : "无法完成差异计算。",
    });
  }
});

function post(response: WorkerResponse): void {
  workerScope.postMessage(response);
}
