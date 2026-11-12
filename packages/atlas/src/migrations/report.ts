import { MigrateDirections, MigrateTargets } from './plan';
import type { IMigrationPlan, IMigrationResult, IMigrationStep } from './plan';
import type { TMigrationDirection } from './schema';

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

const stepOf = (opts: { step: IMigrationStep }): string[] => {
  const { step } = opts;
  const lines = [
    `### ${step.id}`,
    '',
    `From \`${step.entry}\` (${step.date}). Symbols: ${step.symbols.map((symbol) => `\`${symbol}\``).join(', ')}.`,
    '',
  ];

  if (step.touches.length === 0) {
    lines.push('No static import found.');
  } else {
    lines.push(
      'Found in your code:',
      ...step.touches.map((touch) => `- ${touch.file}:${touch.line} (${touch.symbol})`),
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

const planOf = (opts: { plan: IMigrationPlan }): string[] => {
  const { plan } = opts;
  const heading = `## ${plan.package}: ${plan.from} to ${plan.to}`;

  if (plan.direction === MigrateDirections.NONE) {
    return [heading, '', `The app already runs ${plan.to}: nothing to migrate.`, ''];
  }

  const touched = plan.steps.filter((step) => step.touches.length > 0);
  const rest = plan.steps.filter((step) => step.touches.length === 0);
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

  lines.push(
    `${plan.direction === MigrateDirections.UPGRADE ? 'An' : 'A'} ${plan.direction}: ${touched.length} of ${plan.steps.length} changes found in your code.${source}`,
    '',
    ...touched.flatMap((step) => stepOf({ step })),
  );

  if (rest.length > 0) {
    lines.push('### No static import found', '', ...rest.flatMap((step) => stepOf({ step })));
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

export class MigrateReport {
  /** One direction of an item as Markdown lines: numbered steps, or the before and after code. */
  static changeLines(opts: { change: TMigrationDirection }): string[] {
    return changeOf(opts);
  }

  /** The plans as Markdown: what reaches the app first, the rest after, then the entries with no structured steps. */
  static markdown(opts: { result: IMigrationResult }): string {
    const lines = [
      `# Migration plan for ${opts.result.app}`,
      '',
      'Places are found by static imports of the package in `.ts`, `.tsx`, `.js` and similar files; `require()` calls and destructured namespaces are not scanned.',
      '',
      ...opts.result.plans.flatMap((plan) => planOf({ plan })),
    ];

    for (const skipped of opts.result.skipped) {
      lines.push(`Skipped ${skipped.package}: ${skipped.reason}`, '');
    }

    return `${lines.join('\n').trimEnd()}\n`;
  }
}
