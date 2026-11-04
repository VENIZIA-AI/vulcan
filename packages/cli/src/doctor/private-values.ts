import { Glob } from 'bun';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitFiles } from '../common/git-files.ts';
import { EventSecrets } from '../events/common/constants.ts';
import { PrivateValueKinds, PrivateValueScan } from './common/constants.ts';
import type { TPrivateValueKind } from './common/types.ts';
import type { TPrivateValueAcknowledgement } from './schema.ts';

type TCounts = Partial<Record<TPrivateValueKind, number>>;

interface IPrivateFinding {
  file: string;
  /** Hits per kind; the matched text is never kept. */
  counts: TCounts;
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
    /** The acknowledgments that covered no hit: stale, or broad enough to cover files added later. */
    unmatched: TPrivateValueAcknowledgement[];
  } {
    const findings: IPrivateFinding[] = [];
    const used = new Set<TPrivateValueAcknowledgement>();
    const tracked = GitFiles.tracked({ root: opts.root });
    let acknowledgedFiles = 0;

    for (const file of 'files' in tracked ? tracked.files : []) {
      const text = PrivateValues.read({ root: opts.root, file });
      const counts = text === undefined ? [] : Object.entries(PrivateValues.countsOf({ text }));
      const open = counts.filter(([kind]) => {
        const covering = opts.acknowledged.filter(
          (entry) =>
            new Glob(entry.path).match(file) &&
            (entry.kinds?.some((allowed) => allowed === kind) ?? true),
        );

        covering.forEach((entry) => used.add(entry));

        return covering.length === 0;
      });

      if (open.length < counts.length) {
        acknowledgedFiles++;
      }

      if (open.length > 0) {
        findings.push({ file, counts: Object.fromEntries(open) });
      }
    }

    return {
      findings,
      acknowledgedFiles,
      unmatched: opts.acknowledged.filter((entry) => !used.has(entry)),
    };
  }

  /** The text of a tracked regular file, or `undefined` when it is not read: skipped by name, not a file (a submodule, a link), missing, too large or binary. */
  private static read(opts: { root: string; file: string }): string | undefined {
    const path = join(opts.root, opts.file);
    const stat = lstatSync(path, { throwIfNoEntry: false });

    if (
      PrivateValueScan.SKIPPED_PATHS.some((pattern) => pattern.test(opts.file)) ||
      stat === undefined ||
      !stat.isFile() ||
      stat.size === 0 ||
      stat.size > PrivateValueScan.MAX_BYTES
    ) {
      return undefined;
    }

    const bytes = readFileSync(path);

    return bytes.includes(0) ? undefined : bytes.toString('utf8');
  }

  private static countsOf(opts: { text: string }): TCounts {
    const { text } = opts;
    const counts: Record<TPrivateValueKind, number> = {
      [PrivateValueKinds.PRIVATE_KEY]: countOf({ text, pattern: EventSecrets.PRIVATE_KEY }),
      [PrivateValueKinds.TOKEN]: EventSecrets.TOKENS.reduce(
        (sum, pattern) => sum + countOf({ text, pattern }),
        0,
      ),
      [PrivateValueKinds.URL_CREDENTIALS]: countOf({ text, pattern: EventSecrets.URL_USERINFO }),
      [PrivateValueKinds.IPV4]: countOf({
        text,
        pattern: PrivateValueScan.IPV4,
        keep: (match) => !PrivateValueScan.ALLOWED_IPV4.some((pattern) => pattern.test(match)),
      }),
      [PrivateValueKinds.MACHINE_PATH]: countOf({ text, pattern: PrivateValueScan.MACHINE_PATH }),
    };

    return Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 0));
  }
}
