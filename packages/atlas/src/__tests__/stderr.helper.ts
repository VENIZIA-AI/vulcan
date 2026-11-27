import { expect } from 'bun:test';
import { format } from 'node:util';

/**
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
   * Resolves once an unclaimed line holds every one of `parts`, for output that arrives on its own; throws after ten
   * seconds without one.
   */
  async arrival(opts: { parts: string[] }): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (this.lines.some((line) => opts.parts.every((part) => line.includes(part)))) {
        return;
      }

      await Bun.sleep(25);
    }

    throw new Error(
      `no line holding ${JSON.stringify(opts.parts)} arrived in 10 s; unclaimed: ${JSON.stringify(this.lines)}`,
    );
  }

  restore(): void {
    console.error = this.error;
    process.stderr.write = this.write;
    this.keep([this.partial]);
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
