import { Glob } from 'bun';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitFiles } from '../common/git-files.ts';
import { EventSecrets } from '../events/common/constants.ts';
import { PrivateValueKinds, PrivateValueScan } from './common/constants.ts';
import type { TPrivateValueAcknowledgement } from './schema.ts';

interface IPrivateFinding {
  file: string;
  /** Hits per kind; the matched text is never kept. */
  counts: Record<string, number>;
}

const countOf = (opts: {
  text: string;
  pattern: RegExp;
  keep?: (match: string) => boolean;
}): number =>
  [...opts.text.matchAll(opts.pattern)].filter((match) => opts.keep?.(match[0]) ?? true).length;

/** Looks for private values (keys, tokens, credentials, addresses, machine paths) in the files git tracks. */
export class PrivateValues {
  static scan(opts: { root: string; acknowledged: TPrivateValueAcknowledgement[] }): {
    findings: IPrivateFinding[];
    acknowledgedFiles: number;
  } {
    const findings: IPrivateFinding[] = [];
    let acknowledgedFiles = 0;

    for (const file of GitFiles.tracked({ root: opts.root }) ?? []) {
      const text = PrivateValues.read({ root: opts.root, file });
      const counts = text === undefined ? {} : PrivateValues.countsOf({ text });
      const open = Object.entries(counts).filter(
        ([kind]) =>
          !opts.acknowledged.some(
            (entry) =>
              new Glob(entry.path).match(file) &&
              (entry.kinds?.some((allowed) => allowed === kind) ?? true),
          ),
      );

      if (open.length < Object.keys(counts).length) {
        acknowledgedFiles++;
      }

      if (open.length > 0) {
        findings.push({ file, counts: Object.fromEntries(open) });
      }
    }

    return { findings, acknowledgedFiles };
  }

  /** The text of a tracked file, or `undefined` when it is not read: skipped by name, missing, too large or binary. */
  private static read(opts: { root: string; file: string }): string | undefined {
    const path = join(opts.root, opts.file);

    if (PrivateValueScan.SKIPPED_PATHS.some((pattern) => pattern.test(opts.file))) {
      return undefined;
    }

    const { size } = Bun.file(path);

    if (size === 0 || size > PrivateValueScan.MAX_BYTES) {
      return undefined;
    }

    const bytes = readFileSync(path);

    return bytes.includes(0) ? undefined : bytes.toString('utf8');
  }

  private static countsOf(opts: { text: string }): Record<string, number> {
    const { text } = opts;
    const counts: Record<string, number> = {
      [PrivateValueKinds.PRIVATE_KEY]: countOf({ text, pattern: EventSecrets.PRIVATE_KEY }),
      [PrivateValueKinds.TOKEN]: EventSecrets.TOKENS.reduce(
        (sum, pattern) => sum + countOf({ text, pattern }),
        0,
      ),
      [PrivateValueKinds.URL_CREDENTIALS]: countOf({ text, pattern: EventSecrets.URL_USERINFO }),
      [PrivateValueKinds.IPV4]: countOf({
        text,
        pattern: PrivateValueScan.IPV4,
        keep: (match) => !PrivateValueScan.PUBLIC_IPV4.some((pattern) => pattern.test(match)),
      }),
      [PrivateValueKinds.MACHINE_PATH]: countOf({ text, pattern: PrivateValueScan.MACHINE_PATH }),
    };

    return Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 0));
  }
}
