import { MigrateDirections, MigrateTargets } from './plan';
import type { IMigrationPlan, IMigrationResult, IMigrationStep } from './plan';
import { TouchKinds } from './scan';
import type { IMigrationTouch, TTouchKind } from './scan';
import type { TMigrationDirection } from './schema';

const ofKind = (opts: { touches: IMigrationTouch[]; kind: TTouchKind }): IMigrationTouch[] =>
  opts.touches.filter((touch) => touch.kind === opts.kind);

/** Places the app's own code reaches: a name used, or a module imported. A re-export is not one. */
const isReached = (opts: { step: IMigrationStep }): boolean =>
  opts.step.touches.some((touch) => touch.kind !== TouchKinds.REEXPORT);

const isReexportOnly = (opts: { step: IMigrationStep }): boolean =>
  opts.step.touches.length > 0 && !isReached(opts);

/** Where the app passes a module on with `export *`: one line per export line, naming the symbols it carries. */
const reexportLines = (opts: { touches: IMigrationTouch[] }): string[] => {
  const byPlace = new Map<string, string[]>();

  for (const touch of opts.touches) {
    const place = `${touch.file}:${touch.line}`;

    byPlace.set(place, [...(byPlace.get(place) ?? []), touch.symbol]);
  }

  return [...byPlace.entries()].map(([place, symbols]) => `- ${place} (${symbols.join(', ')})`);
};

/** A module symbol is imported by many files and the import is not what breaks: a count, and the files only on request. */
const moduleLines = (opts: { touches: IMigrationTouch[]; verbose: boolean }): string[] => {
  const symbols = [...new Set(opts.touches.map((touch) => touch.symbol))];

  return symbols.flatMap((symbol) => {
    const files = opts.touches.filter((touch) => touch.symbol === symbol);
    const count = `${files.length} ${files.length === 1 ? 'place imports' : 'places import'}`;

    return opts.verbose
      ? [`${count} \`${symbol}\`:`, ...files.map((touch) => `- ${touch.file}:${touch.line}`)]
      : [
          `${count} \`${symbol}\`. The import itself is not what breaks: act on the steps below. List the places with \`--verbose\`.`,
        ];
  });
};

const changeOf = (opts: { change: TMigrationDirection }): string[] => {
  if ('steps' in opts.change) {
    return opts.change.steps.map((step, index) => `${index + 1}. ${step}`);
  }

  return [
    'Before:',
    '',
    '```ts',
    opts.change.before,
    '```',
    '',
    'After:',
    '',
    '```ts',
    opts.change.after,
    '```',
  ];
};

const stepOf = (opts: { step: IMigrationStep; verbose: boolean }): string[] => {
  const { step } = opts;
  const lines = [
    `### ${step.id}`,
    '',
    `From \`${step.entry}\` (${step.date}). Symbols: ${step.symbols.map((symbol) => `\`${symbol}\``).join(', ')}.`,
    '',
  ];

  const named = ofKind({ touches: step.touches, kind: TouchKinds.NAME });
  const modules = ofKind({ touches: step.touches, kind: TouchKinds.MODULE });
  const reexports = ofKind({ touches: step.touches, kind: TouchKinds.REEXPORT });

  if (step.touches.length === 0) {
    lines.push('No static import found.');
  }

  if (named.length > 0) {
    lines.push(
      'Found in your code:',
      ...named.map((touch) => `- ${touch.file}:${touch.line} (${touch.symbol})`),
    );
  }

  if (modules.length > 0) {
    lines.push(
      ...(named.length > 0 ? [''] : []),
      ...moduleLines({ touches: modules, verbose: opts.verbose }),
    );
  }

  if (reexports.length > 0) {
    lines.push(
      ...(named.length + modules.length > 0 ? [''] : []),
      'Re-exported by your code (your consumers may be hit; your own code needs no change):',
      ...reexportLines({ touches: reexports }),
    );
  }

  lines.push('', ...changeOf({ change: step.change }));

  if (step.data !== undefined) {
    lines.push('', `Data: ${step.data}`);
  }

  if (step.codemod !== undefined) {
    lines.push('', `Codemod: \`${step.codemod}\``);
  }

  lines.push('');

  return lines;
};

const countOf = (opts: { count: number; one: string; many: string }): string =>
  `${opts.count} ${opts.count === 1 ? opts.one : opts.many}`;

const planOf = (opts: { plan: IMigrationPlan; verbose: boolean }): string[] => {
  const { plan } = opts;
  const heading = `## ${plan.package}: ${plan.from} to ${plan.to}`;

  if (plan.direction === MigrateDirections.NONE) {
    return [heading, '', `The app already runs ${plan.to}: nothing to migrate.`, ''];
  }

  const touched = plan.steps.filter((step) => isReached({ step }));
  const rest = plan.steps.filter((step) => !isReached({ step }));
  const reexported = rest.filter((step) => isReexportOnly({ step })).length;
  const source =
    plan.target === MigrateTargets.RELEASE_TABLE
      ? ' The target version comes from the atlas release table, not the registry.'
      : '';
  const lines = [heading, ''];

  if (plan.note !== undefined) {
    lines.push(`Note: ${plan.note}`, '');
  }

  if (plan.apply !== undefined) {
    lines.push(`Run the codemods: \`${plan.apply}\``, '');
  }

  const article = plan.direction === MigrateDirections.UPGRADE ? 'An' : 'A';

  if (plan.entries === 0) {
    // An empty window is the one answer that must not read as a clean one.
    lines.push(
      `${article} ${plan.direction}: No changelog entry falls between ${plan.from} and ${plan.to} in the release table. That proves nothing about the move: check that the package's source was indexed with its changelog (\`vulcan x atlas releases\`).${source}`,
      '',
    );
  } else {
    const unchecked =
      plan.unstructured.length === 0
        ? ''
        : `; ${countOf({ count: plan.unstructured.length, one: 'breaking entry has', many: 'breaking entries have' })} no structured steps, so the scan could not check ${plan.unstructured.length === 1 ? 'it' : 'them'}`;

    lines.push(
      `${article} ${plan.direction}: ${countOf({ count: plan.entries, one: 'changelog entry', many: 'changelog entries' })} in the window; ${countOf({ count: plan.steps.length, one: 'structured step', many: 'structured steps' })}, ${touched.length} found in your code${reexported === 0 ? '' : `, ${reexported} only re-exported`}${unchecked}.${source}`,
      '',
      ...touched.flatMap((step) => stepOf({ step, verbose: opts.verbose })),
    );
  }

  if (rest.length > 0) {
    lines.push(
      '### No static import found',
      '',
      ...rest.flatMap((step) => stepOf({ step, verbose: opts.verbose })),
    );
  }

  if (plan.unstructured.length > 0) {
    lines.push(
      '### Breaking changes without structured steps',
      '',
      'Read each with the atlas `get` tool:',
      '',
      ...plan.unstructured.map((entry) => `- \`${entry.id}\` (${entry.date}): ${entry.title}`),
      '',
    );
  }

  if (plan.unreadable.length > 0) {
    lines.push(`Not read (${plan.unreadable.length}): ${plan.unreadable.join(', ')}`, '');
  }

  return lines;
};

/** What the server said about a source it could not serve: first, so a plan from the other sources never reads as complete. */
const warningOf = (opts: { result: IMigrationResult }): string[] =>
  opts.result.notServed === undefined ? [] : [`Warning: ${opts.result.notServed.message}`, ''];

export class MigrateReport {
  /** One direction of an item as Markdown lines: numbered steps, or the before and after code. */
  static changeLines(opts: { change: TMigrationDirection }): string[] {
    return changeOf(opts);
  }

  /**
   * The plans as Markdown: what reaches the app first, the rest after, then the entries with no structured steps.
   * `verbose` lists the places that import a module symbol; otherwise they are a count.
   */
  static markdown(opts: { result: IMigrationResult; verbose?: boolean }): string {
    const verbose = opts.verbose ?? false;
    const lines = [
      `# Migration plan for ${opts.result.app}`,
      '',
      ...warningOf({ result: opts.result }),
      'Places are found by static imports of the package in `.ts`, `.tsx`, `.js` and similar files; `require()` calls and destructured namespaces are not scanned.',
      '',
      ...opts.result.plans.flatMap((plan) => planOf({ plan, verbose })),
    ];

    if (opts.result.unserved.length > 0) {
      lines.push(`Not served by any atlas source: ${opts.result.unserved.join(', ')}.`, '');
    }

    for (const skipped of opts.result.skipped) {
      lines.push(`Skipped ${skipped.package}: ${skipped.reason}`, '');
    }

    return `${lines.join('\n').trimEnd()}\n`;
  }
}
