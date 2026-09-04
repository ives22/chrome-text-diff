import type { CompareOptions, DiffResult } from "./types";

export interface CompareWorkerRequest {
  type: "COMPARE";
  requestId: string;
  leftText: string;
  rightText: string;
  options: CompareOptions;
}

export interface CancelWorkerRequest {
  type: "CANCEL";
  requestId: string;
}

export type WorkerRequest = CompareWorkerRequest | CancelWorkerRequest;

export type WorkerResponse =
  | { type: "RESULT"; requestId: string; result: DiffResult }
  | { type: "ERROR"; requestId: string; message: string };

export interface WorkerLike {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: WorkerRequest): void;
  terminate(): void;
}

type WorkerFactory = () => WorkerLike;

interface ActiveRequest {
  requestId: string;
  worker: WorkerLike;
  reject: (reason: Error) => void;
}

export class DiffWorkerClient {
  private active: ActiveRequest | null = null;

  constructor(
    private readonly createWorker: WorkerFactory = () =>
      new Worker(new URL("../workers/diff.worker.ts", import.meta.url), {
        type: "module",
        name: "textdiff-comparison",
      }),
  ) {}

  compare(leftText: string, rightText: string, options: CompareOptions): Promise<DiffResult> {
    this.cancel();
    const worker = this.createWorker();
    const requestId = crypto.randomUUID();

    return new Promise<DiffResult>((resolve, reject) => {
      this.active = { requestId, worker, reject };

      worker.onmessage = (event) => {
        if (event.data.requestId !== requestId) return;
        this.finish(worker);
        if (event.data.type === "RESULT") {
          resolve(event.data.result);
        } else {
          reject(new Error(event.data.message));
        }
      };

      worker.onerror = () => {
        this.finish(worker);
        reject(new Error("差异计算进程发生异常，请重试。"));
      };

      worker.postMessage({
        type: "COMPARE",
        requestId,
        leftText,
        rightText,
        options,
      });
    });
  }

  cancel(): void {
    if (!this.active) return;

    const { requestId, worker, reject } = this.active;
    worker.postMessage({ type: "CANCEL", requestId });
    worker.terminate();
    this.active = null;
    const error = new Error("差异计算已被新请求取消。");
    error.name = "AbortError";
    reject(error);
  }

  dispose(): void {
    this.cancel();
  }

  private finish(worker: WorkerLike): void {
    worker.terminate();
    if (this.active?.worker === worker) this.active = null;
  }
}
