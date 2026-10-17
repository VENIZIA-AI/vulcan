import { loadConceptsOrExit } from '../lib.ts';
import {
  collectBindingKeys,
  collectComponents,
  collectHelperModules,
  collectMakefileTargets,
  collectSourceMap,
  exampleDirs,
  packageDirs,
} from '../source/index.ts';

// --- coverage ---

export const percent = (opts: { value: number; total: number }): number => {
  return opts.total ? Math.round((opts.value / opts.total) * 100) : 100;
};

export const pad = (opts: { value: string; width: number }): string => {
  return (opts.value + ' '.repeat(opts.width)).slice(0, opts.width);
};

export const coverage = (): void => {
  const concepts = loadConceptsOrExit().filter(concept => !concept.reserved);
  const ids = new Set(concepts.map(concept => concept.id));

  const hasId = (opts: { id: string }): boolean => ids.has(opts.id);
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

  lines.push('STRUCTURAL  (target 100% - one curated concept each)');
  struct({
    name: 'packages',
    items: packageDirs(),
    covered: name => hasId({ id: '/packages/' + name }),
  });
  struct({
    name: 'examples',
    items: exampleDirs(),
    covered: name => hasId({ id: '/examples/' + name }),
  });

  // Reference axes - advisory; exhaustive coverage comes from generation.
  lines.push('', 'REFERENCE  (advisory - generated)');
  const ref = (opts: { name: string; count: number; generated: boolean }): void => {
    lines.push(
      `  ${pad({ value: opts.name, width: 15 })} ${pad({ value: String(opts.count), width: 6 })}  ` +
        `${opts.generated ? 'generated' : 'NOT generated'}`,
    );
  };

  const components = collectComponents();
  const helperModules = collectHelperModules();
  const bindingClasses = collectBindingKeys();

  ref({
    name: 'components',
    count: components.reduce((sum, entry) => sum + entry.classes.length, 0),
    generated: hasId({ id: '/reference/components' }),
  });
  ref({
    name: 'helper modules',
    count: helperModules.length,
    generated: hasId({ id: '/reference/helpers' }),
  });
  ref({
    name: 'binding keys',
    count: bindingClasses.reduce((sum, entry) => sum + entry.keys.length, 0),
    generated: hasId({ id: '/reference/binding-keys' }),
  });
  ref({
    name: 'make targets',
    count: collectMakefileTargets().length,
    generated: hasId({ id: '/reference/makefile-targets' }),
  });
  ref({
    name: 'source files',
    count: collectSourceMap().reduce((sum, entry) => sum + entry.total, 0),
    generated: hasId({ id: '/reference/source-map' }),
  });

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
