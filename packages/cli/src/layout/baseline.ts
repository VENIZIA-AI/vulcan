import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { LayoutConstants, LayoutRules } from './common/index.ts';
import type { ILayoutFinding, TLayoutRule } from './common/index.ts';

const ENTRY = z.strictObject({
  rule: z.custom<TLayoutRule>((value) => LayoutRules.isValid(value), {
    message: `one of ${LayoutRules.values().join(', ')}`,
  }),
  path: z.string().min(1),
});

const BASELINE = z.array(ENTRY);

export type TLayoutBaselineEntry = z.output<typeof ENTRY>;

const keyOf = (opts: { entry: TLayoutBaselineEntry }): string =>
  `${opts.entry.rule}\0${opts.entry.path}`;

/** The findings a project accepted when it adopted the layout check: `.configs/layout-baseline.json`, a list of `{ rule, path }`. */
export class LayoutBaseline {
  /** The entries of the baseline at `root`, none when there is no file, or why the file is not one. */
  static read(opts: { root: string }): { entries: TLayoutBaselineEntry[] } | { error: string } {
    const file = join(opts.root, LayoutConstants.BASELINE_FILE);

    if (!existsSync(file)) {
      return { entries: [] };
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      return {
        error: `${LayoutConstants.BASELINE_FILE} is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const result = BASELINE.safeParse(parsed);

    return result.success
      ? { entries: result.data }
      : {
          error: `${LayoutConstants.BASELINE_FILE}: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
        };
  }

  /** Writes every finding as the baseline, sorted by path then rule, one entry per rule and path; returns how many. */
  static write(opts: { root: string; findings: ILayoutFinding[] }): number {
    const entries = [
      ...new Map(
        opts.findings.map((finding) => {
          const entry = { rule: finding.rule, path: finding.path };

          return [keyOf({ entry }), entry];
        }),
      ).values(),
    ].sort(
      (left, right) => left.path.localeCompare(right.path) || left.rule.localeCompare(right.rule),
    );

    const file = join(opts.root, LayoutConstants.BASELINE_FILE);

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`);

    return entries.length;
  }

  /** The findings the baseline does not hold (`open`), the ones it does (`accepted`), and its entries that match no finding (`stale`). */
  static split(opts: { findings: ILayoutFinding[]; entries: TLayoutBaselineEntry[] }): {
    open: ILayoutFinding[];
    accepted: ILayoutFinding[];
    stale: TLayoutBaselineEntry[];
  } {
    const listed = new Set(opts.entries.map((entry) => keyOf({ entry })));
    const found = new Set(opts.findings.map((entry) => keyOf({ entry })));

    return {
      open: opts.findings.filter((entry) => !listed.has(keyOf({ entry }))),
      accepted: opts.findings.filter((entry) => listed.has(keyOf({ entry }))),
      stale: opts.entries.filter((entry) => !found.has(keyOf({ entry }))),
    };
  }
}
