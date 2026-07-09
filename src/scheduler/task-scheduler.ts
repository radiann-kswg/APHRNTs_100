export interface ScheduledTask {
  name: string;
  intervalMs: number;
  run: (now: Date) => Promise<void> | void;
}

export class TaskScheduler {
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly tasks: ScheduledTask[]) {}

  start(): void {
    for (const task of this.tasks) {
      const timer = setInterval(() => {
        void Promise.resolve(task.run(new Date())).catch((error: unknown) => {
          console.error(`[scheduler] task "${task.name}" failed:`, error);
        });
      }, task.intervalMs);
      this.timers.push(timer);
    }
  }

  stop(): void {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
  }
}
