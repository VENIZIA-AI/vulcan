import { loadGeneration } from '../generate/index.ts';
import { loadConceptsOrExit } from '../lib.ts';
import { packageDirs } from '../source/index.ts';
import { collectCoverageAxes } from './axes.ts';

// --- coverage ---

export const percent = (opts: { value: number; total: number }): number => {
  return opts.total ? Math.round((opts.value / opts.total) * 100) : 100;
};

export const pad = (opts: { value: string; width: number }): string => {
  return (opts.value + ' '.repeat(opts.width)).slice(0, opts.width);
};

export const coverage = async (): Promise<void> => {
  const concepts = loadConceptsOrExit().filter(concept => !concept.reserved);
  const ids = new Set(concepts.map(concept => concept.id));

  const hasId = (opts: { id: string }): boolean => ids.has(opts.id);
  const resources = new Set(
    concepts.map(concept => concept.resource.replace(/^\.\//, '').replace(/\/+$/, '')),
  );
  const lines: string[] = [];
  let structCovered = 0;
  let structTotal = 0;

  const struct = (opts: {
    name: string;
    items: string[];
    covered: (item: string) => boolean;
  }): void => {
    const { name, items, covered } = opts;

    const missing = items.filter(item => !covered(item));
    const value = items.length - missing.length;

    structCovered += value;
    structTotal += items.length;

    lines.push(
      `  ${pad({ value: name, width: 15 })} ${pad({ value: `${value}/${items.length}`, width: 8 })} ` +
        `${pad({ value: percent({ value, total: items.length }) + '%', width: 5 })}` +
        (missing.length
          ? `  missing: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`
          : ''),
    );
  };

  const { axes, problems } = collectCoverageAxes();

  // The report would count an axis that covers nothing as fully covered.
  if (problems.length > 0) {
    throw new Error(`okf: ${problems.join('; ')}`);
  }

  lines.push('STRUCTURAL  (target 100% - one curated concept each)');
  for (const axis of axes) {
    struct({
      name: axis.name,
      items: axis.items,
      covered: item =>
        hasId({ id: `/${axis.name}/${item}` }) || resources.has(axis.paths[item] ?? item),
    });
  }

  // Reference axes - advisory; exhaustive coverage comes from generation.
  lines.push('', 'REFERENCE  (advisory - generated)');
  const ref = (opts: { name: string; count: number; generated: boolean }): void => {
    lines.push(
      `  ${pad({ value: opts.name, width: 15 })} ${pad({ value: String(opts.count), width: 6 })}  ` +
        `${opts.generated ? 'generated' : 'NOT generated'}`,
    );
  };

  // One row per configured renderer that reports one, from the same facts its table renders.
  for (const { renderer, context } of (await loadGeneration()).renderers) {
    if (renderer.coverage === undefined) {
      continue;
    }

    const facts = renderer.collect({ context });
    const row = renderer.coverage({ facts });
    const path = renderer.render?.({ context, facts }).path;

    ref({
      name: row.name,
      count: row.count,
      generated: path !== undefined && hasId({ id: '/' + path.replace(/\.md$/, '') }),
    });
  }

  // Knowledge types (Diátaxis / arc42).
  const types: Record<string, number> = {};

  for (const concept of concepts) {
    types[concept.type] = (types[concept.type] || 0) + 1;
  }

  const playbookTarget = packageDirs().length;

  lines.push('', 'KNOWLEDGE TYPES  (Diátaxis / arc42)');
  lines.push(
    '  ' +
      Object.entries(types)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `${type}:${count}`)
        .join('  '),
  );
  lines.push(
    `  how-to (Playbook) ${types['Playbook'] || 0}  (target >= ${playbookTarget})` +
      `${(types['Playbook'] || 0) < playbookTarget ? '  <- gap' : ''}`,
  );
  lines.push(
    `  tutorial ${types['Tutorial'] || 0}  (target 1)${!types['Tutorial'] ? '  <- gap' : ''}`,
  );
  lines.push(
    `  glossary ${types['Glossary'] || 0}  (target 1)${!types['Glossary'] ? '  <- gap' : ''}`,
  );

  console.log(`\nCOVERAGE - ${concepts.length} curated concepts\n`);
  console.log(lines.join('\n'));
  console.log(
    `\nstructural: ${structCovered}/${structTotal}  ${percent({ value: structCovered, total: structTotal })}%`,
  );

  const minIndex = process.argv.indexOf('--min');

  if (minIndex === -1) {
    return;
  }

  // `--min 0` must mean 0. `Number(x) || 100` silently turned a valid 0 into 100.
  const raw = process.argv[minIndex + 1];
  const min = Number(raw);

  if (raw === undefined || !Number.isFinite(min)) {
    console.error(
      `\ncoverage: --min needs a number, got ${raw === undefined ? '(nothing)' : `"${raw}"`}`,
    );
    process.exit(2);
  }

  const structPercent = percent({ value: structCovered, total: structTotal });

  if (structPercent < min) {
    console.error(`\ncoverage gate FAILED: structural ${structPercent}% < ${min}%`);
    process.exit(1);
  }
};
