import { join } from 'node:path';
import { readOkfProject } from '../project/index.ts';
import type { GeneratedFile } from './common/types.ts';
import {
  collectBindingKeys,
  collectComponents,
  collectHelperModules,
  collectHelperUtilities,
  collectMakefileTargets,
  collectPackageManifests,
  collectSourceMap,
} from '../source/index.ts';

// --- renderers ---

/**
 * OKF v0.2 frontmatter for a generated reference file: `generated.by` marks it machine-written (§5.2).
 * No `generated.at` - a timestamp would make every regeneration look like a change.
 */
export const refHeader = (opts: {
  title: string;
  description: string;
  resource: string;
  tags: string;
}): string => {
  const { title, description, resource, tags } = opts;

  return [
    '---',
    'type: Reference',
    `title: ${title}`,
    `description: ${description}`,
    `resource: ${resource}`,
    `tags: [${tags}]`,
    'generated:',
    '  by: process:okf-gen',
    '---',
    '',
    '',
  ].join('\n');
};

export const generatedNote = (opts: { seeAlso: string }): string => {
  return `> Generated from source - do not edit; run \`make okf-gen\`. ${opts.seeAlso}\n\n`;
};

export const renderSourceMap = (): GeneratedFile => {
  const entries = collectSourceMap();
  const total = entries.reduce((sum, entry) => sum + entry.total, 0);

  const body = entries
    .map(entry => {
      const heading = `## ${entry.pkg}  (${entry.total} source files)`;

      // A package may keep a flat src/ (no subsystem dirs) - render prose, not an empty table.
      if (!entry.subsystems.length) {
        return [heading, '', '_Flat `src/` - no subsystem directories._'].join('\n');
      }

      const rows = entry.subsystems.map(sub => `| \`${sub.name}/\` | ${sub.files} |`);

      return [heading, '', '| Subsystem | Files |', '|---|---|', ...rows].join('\n');
    })
    .join('\n\n');

  return {
    path: join(readOkfProject().bundle, 'reference/source-map.md'),
    content:
      refHeader({
        title: 'Source map',
        description:
          'Every package subsystem under packages/*/src with its source-file count (generated).',
        resource: 'packages',
        tags: 'reference, source-map, packages',
      }) +
      generatedNote({ seeAlso: 'Layout: [monorepo layout](/overview/monorepo-layout.md).' }) +
      `**${total} source files across ${entries.length} packages.**\n\n` +
      body +
      '\n',
  };
};

export const renderComponents = (): GeneratedFile => {
  const entries = collectComponents();
  const total = entries.reduce((sum, entry) => sum + entry.classes.length, 0);

  const rows = entries.map(entry => {
    const classes = entry.classes.map(name => `\`${name}\``).join(' · ') || '_(see source)_';

    return `| \`${entry.dir}/\` | ${classes} |`;
  });

  return {
    path: join(readOkfProject().bundle, 'reference/components.md'),
    content:
      refHeader({
        title: 'Components catalog',
        description:
          'Every component under packages/core-server/src/components and its exported classes (generated).',
        resource: 'packages/core-server/src/components',
        tags: 'reference, components, core',
      }) +
      generatedNote({ seeAlso: 'Model: [component model](/architecture/component-model.md).' }) +
      `**${total} component classes across ${entries.length} component directories.**\n\n` +
      ['| Directory | Classes |', '|---|---|', ...rows].join('\n') +
      '\n',
  };
};

export const renderHelpers = (): GeneratedFile => {
  const modules = collectHelperModules();
  const utilities = collectHelperUtilities();
  const total = modules.reduce((sum, entry) => sum + entry.classes.length, 0);

  const rows = modules.map(entry => {
    const classes = entry.classes.map(name => `\`${name}\``).join(' · ') || '_(see source)_';

    return `| \`${entry.module}/\` | ${classes} |`;
  });

  return {
    path: join(readOkfProject().bundle, 'reference/helpers.md'),
    content:
      refHeader({
        title: 'Helpers catalog',
        description: 'Every helper module and utility in packages/helpers (generated).',
        resource: 'packages/helpers/src',
        tags: 'reference, helpers, catalog',
      }) +
      generatedNote({ seeAlso: 'Package: [helpers](/packages/helpers.md).' }) +
      `**${total} helper classes across ${modules.length} modules, ${utilities.length} utilities.**\n\n` +
      ['## Modules', '', '| Module | Classes |', '|---|---|', ...rows].join('\n') +
      '\n\n## Utilities\n\n' +
      (utilities.map(name => `\`${name}\``).join(' · ') || '-') +
      '\n',
  };
};

export const renderBindingKeys = (): GeneratedFile => {
  const classes = collectBindingKeys();
  const total = classes.reduce((sum, entry) => sum + entry.keys.length, 0);

  const body = classes
    .map(entry => {
      const rows = entry.keys.map(key => `| \`${key.key}\` | \`${key.value}\` |`);

      return [`## ${entry.name}`, '', '| Constant | Key |', '|---|---|', ...rows].join('\n');
    })
    .join('\n\n');

  return {
    path: join(readOkfProject().bundle, 'reference/binding-keys.md'),
    content:
      refHeader({
        title: 'Binding keys',
        description: 'Every dependency-injection binding key declared in the kernel (generated).',
        resource: 'packages/kernel/src/common/bindings.ts',
        tags: 'reference, bindings, di',
      }) +
      generatedNote({
        seeAlso: 'Namespaces: [binding key namespaces](/conventions/binding-key-namespaces.md).',
      }) +
      `**${total} keys across ${classes.length} binding classes.**\n\n` +
      (body || '_(none found)_') +
      '\n',
  };
};

export const renderMakefileTargets = (): GeneratedFile => {
  const targets = collectMakefileTargets();

  const rows = targets.map(target => {
    return `| \`make ${target.name}\` | ${target.deps ? `\`${target.deps}\`` : '-'} | ${target.description || '-'} |`;
  });

  return {
    path: join(readOkfProject().bundle, 'reference/makefile-targets.md'),
    content:
      refHeader({
        title: 'Makefile targets',
        description: 'Every make target, its prerequisites, and what it does (generated).',
        resource: 'Makefile',
        tags: 'reference, make, build',
      }) +
      generatedNote({ seeAlso: 'Playbook: [build system](/process/build-system.md).' }) +
      `**${targets.length} targets.**\n\n` +
      ['| Target | Depends on | Description |', '|---|---|---|', ...rows].join('\n') +
      '\n',
  };
};

/** Whole generated files. Add a renderer here and `gen`/`check` pick it up automatically. */
export const RENDERERS: { id: string; render: () => GeneratedFile }[] = [
  { id: 'source-map', render: renderSourceMap },
  { id: 'components', render: renderComponents },
  { id: 'helpers', render: renderHelpers },
  { id: 'binding-keys', render: renderBindingKeys },
  { id: 'makefile-targets', render: renderMakefileTargets },
];

export const renderPackagesTable = (): string => {
  const rows = collectPackageManifests().map(entry => {
    return `| [\`${entry.dir}\`](/packages/${entry.dir}.md) | \`${entry.name}\` | ${entry.description || '-'} |`;
  });

  return ['| Package | npm name | Description |', '|---|---|---|', ...rows].join('\n');
};

/** Managed regions inside hand-authored files - computed per call: the bundle comes from the project. */
export const listRegions = (): { id: string; file: string; render: () => string }[] => [
  {
    id: 'packages-table',
    file: join(readOkfProject().bundle, 'overview/monorepo-layout.md'),
    render: renderPackagesTable,
  },
];
