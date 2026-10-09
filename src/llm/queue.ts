/**
 * Single-flight queue: one job at a time, in submission order. Pure.
 * Used so only one llama.rn completion ever runs on the context.
 */

export class QueueClearedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'QueueClearedError';
  }
}

interface Job<T> {
  run: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

export class SerialQueue {
  private jobs: Job<any>[] = [];
  private running: Promise<void> | null = null;

  get busy(): boolean {
    return this.running !== null;
  }

  get pending(): number {
    return this.jobs.length;
  }

  enqueue<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.jobs.push({ run, resolve, reject });
      this.pump();
    });
  }

  /** Reject every job that has not started yet. */
  clear(reason = 'cleared'): void {
    const jobs = this.jobs;
    this.jobs = [];
    for (const j of jobs) {
      j.reject(new QueueClearedError(reason));
    }
  }

  /** Resolves once the running job (if any) has settled. */
  async settled(): Promise<void> {
    while (this.running) {
      await this.running;
    }
  }

  private pump(): void {
    if (this.running) {
      return;
    }
    const job = this.jobs.shift();
    if (!job) {
      return;
    }
    this.running = (async () => {
      try {
        job.resolve(await job.run());
      } catch (e) {
        job.reject(e);
      }
    })().finally(() => {
      this.running = null;
      this.pump();
    });
  }
}
