import type { Logger } from '@armada/observability';

export type TickHandler = (tick: number) => Promise<void> | void;

export interface SchedulerOptions {
  readonly logger: Logger;
  readonly intervalMs: number;
  readonly handler: TickHandler;
}

export interface Scheduler {
  start(): void;
  /** Resolves after any in-flight tick finishes. */
  stop(): Promise<void>;
  readonly ticks: number;
}

/**
 * Minimal interval scheduler for the worker placeholder.
 *
 * Real ingestion/reconciliation jobs (Epic 5) replace this with a durable
 * queue; the seam to keep is: handlers are injected, errors are contained per
 * tick, and shutdown waits for in-flight work.
 */
export function createScheduler(options: SchedulerOptions): Scheduler {
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> = Promise.resolve();
  let tickCount = 0;

  const runTick = (): void => {
    const tick = ++tickCount;
    inFlight = (async () => {
      try {
        await options.handler(tick);
      } catch (err) {
        // A failing job must never kill the worker loop.
        options.logger.error('tick failed', { tick, err });
      }
    })();
  };

  return {
    start() {
      if (timer !== undefined) return;
      timer = setInterval(runTick, options.intervalMs);
      options.logger.info('scheduler started', { intervalMs: options.intervalMs });
    },
    async stop() {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      await inFlight;
      options.logger.info('scheduler stopped', { ticks: tickCount });
    },
    get ticks() {
      return tickCount;
    },
  };
}
