import { describe, expect, it } from "vitest";
import { DEFAULT_COMPARE_OPTIONS, type DiffResult } from "../src/core/types";
import {
  DiffWorkerClient,
  type WorkerLike,
  type WorkerResponse,
} from "../src/core/diffWorkerClient";

class FakeWorker implements WorkerLike {
  messages: unknown[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: unknown) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emit(message: WorkerResponse) {
    this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>);
  }
}

const emptyResult: DiffResult = {
  rows: [],
  hunks: [],
  stats: { added: 0, removed: 0, unchanged: 0, hunks: 0 },
};

describe("DiffWorkerClient", () => {
  it("resolves the matching worker response", async () => {
    const workers: FakeWorker[] = [];
    const client = new DiffWorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });

    const pending = client.compare("left", "right", DEFAULT_COMPARE_OPTIONS);
    const request = workers[0]?.messages[0] as { requestId: string; type: string };
    workers[0]?.emit({ type: "RESULT", requestId: request.requestId, result: emptyResult });

    await expect(pending).resolves.toEqual(emptyResult);
    expect(request.type).toBe("COMPARE");
    expect(workers[0]?.terminated).toBe(true);
  });

  it("cancels and terminates an older calculation when a new one starts", async () => {
    const workers: FakeWorker[] = [];
    const client = new DiffWorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });

    const first = client.compare("first", "old", DEFAULT_COMPARE_OPTIONS);
    const second = client.compare("second", "new", DEFAULT_COMPARE_OPTIONS);

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(workers[0]?.messages.at(-1)).toMatchObject({ type: "CANCEL" });
    expect(workers[0]?.terminated).toBe(true);

    const secondRequest = workers[1]?.messages[0] as { requestId: string };
    workers[1]?.emit({
      type: "RESULT",
      requestId: secondRequest.requestId,
      result: emptyResult,
    });
    await expect(second).resolves.toEqual(emptyResult);
  });

  it("rejects a worker error response with its message", async () => {
    const worker = new FakeWorker();
    const client = new DiffWorkerClient(() => worker);
    const pending = client.compare("left", "right", DEFAULT_COMPARE_OPTIONS);
    const request = worker.messages[0] as { requestId: string };

    worker.emit({ type: "ERROR", requestId: request.requestId, message: "计算失败" });

    await expect(pending).rejects.toThrow("计算失败");
  });
});
