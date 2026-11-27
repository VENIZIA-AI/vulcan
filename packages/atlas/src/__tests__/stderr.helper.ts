import { expect } from 'bun:test';
import { format } from 'node:util';

/**
 * The same class as `packages/cli/src/__tests__/stderr.helper.ts`, whose behaviour is tested beside that one.
 *
 * What one test writes to stderr: `console.error` (every atlas logger line) and, when asked,
 * `process.stderr.write` (a child's relayed output). A test claims each line it provokes; `restore`,
 * called from `afterEach`, puts stderr back and fails on any line left unclaimed.
 */
export class CapturedStderr {
  private readonly lines: string[] = [];
  private readonly error = console.error;
  private readonly write = process.stderr.write;
  /** What was written to `process.stderr` after its last newline: the rest of that line is still to come. */
  private partial = '';
  private readonly decoder = new TextDecoder();

  private constructor(opts: { processWrites: boolean }) {
    console.error = (...args: unknown[]): void => {
      this.lines.push(format(...args));
    };

    if (opts.processWrites) {
      process.stderr.write = (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
        const text =
          typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
        const parts = `${this.partial}${text}`.split('\n');

        this.partial = parts.pop() ?? '';
        this.keep(parts);

        // A writer that waits for its callback goes on, after this call returns as with the real stream.
        const done = rest.find((value): value is () => void => typeof value === 'function');

        if (done !== undefined) {
          queueMicrotask(done);
        }

        return true;
      };
    }
  }

  static start(opts: { processWrites?: boolean } = {}): CapturedStderr {
    return new CapturedStderr({ processWrites: opts.processWrites === true });
  }

  /** Exactly `times` unclaimed lines hold every one of `parts`; they are claimed. */
  claim(opts: { parts: string[]; times?: number }): void {
    expect(this.take(opts)).toHaveLength(opts.times ?? 1);
  }

  /** As `claim`, for a line whose count depends on timing: one or more. */
  claimSome(opts: { parts: string[] }): void {
    expect(this.take(opts).length).toBeGreaterThan(0);
  }

  /**
   * Resolves once an unclaimed line holds every one of `parts`, for output that arrives on its own; throws after `ms` without
   * one, by default four seconds: before a test's own five seconds end it without saying what it waited for.
   */
  async arrival(opts: { parts: string[]; ms?: number }): Promise<void> {
    const ms = opts.ms ?? 4000;

    const deadline = Date.now() + ms;

    // By the clock: a loaded machine sleeps longer than asked.
    while (Date.now() < deadline) {
      if (this.lines.some((line) => opts.parts.every((part) => line.includes(part)))) {
        return;
      }

      await Bun.sleep(25);
    }

    throw new Error(
      `no line holding ${JSON.stringify(opts.parts)} arrived in ${ms} ms; unclaimed: ${JSON.stringify(this.lines)}`,
    );
  }

  restore(): void {
    console.error = this.error;
    process.stderr.write = this.write;
    // The decoder may still hold the first bytes of a letter whose last ones never came.
    this.keep([`${this.partial}${this.decoder.decode()}`]);
    this.partial = '';

    expect(this.lines.splice(0)).toEqual([]);
  }

  private keep(lines: string[]): void {
    this.lines.push(...lines.filter((line) => line.trim() !== ''));
  }

  private take(opts: { parts: string[] }): string[] {
    const taken: string[] = [];

    for (let index = this.lines.length - 1; index >= 0; index -= 1) {
      if (opts.parts.every((part) => this.lines[index].includes(part))) {
        taken.push(...this.lines.splice(index, 1));
      }
    }

    return taken;
  }
}
