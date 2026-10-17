import { join } from 'node:path';
import { defineRenderer } from './define.ts';
import type { IRenderContext, IRenderer } from './define.ts';
import {
  collectBindingKeys,
  collectMakefileTargets,
  collectPackageManifests,
  collectSourceMap,
} from '../source/index.ts';

// --- options ---

/** A string option, or the built-in's default. */
const stringOption = (opts: { context: IRenderContext; key: string; fallback: string }): string => {
  const value = opts.context.options[opts.key];

  return typeof value === 'string' ? value : opts.fallback;
};

// --- built-in renderers ---

const sourceMapRenderer = defineRenderer({
  id: 'source-map',
  collect: () => collectSourceMap(),
  render: ({ context, facts }) => {
    const total = facts.reduce((sum, entry) => sum + entry.total, 0);

    const body = facts
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
      path: stringOption({ context, key: 'path', fallback: 'reference/source-map.md' }),
      content:
        context.page.header({
          title: 'Source map',
          description:
            'Every package subsystem under packages/*/src with its source-file count (generated).',
          resource: 'packages',
          tags: ['reference', 'source-map', 'packages'],
        }) +
        context.page.note({
          seeAlso: stringOption({
            context,
            key: 'seeAlso',
            fallback: 'Layout: [monorepo layout](/overview/monorepo-layout.md).',
          }),
        }) +
        `**${total} source files across ${facts.length} packages.**\n\n` +
        body +
        '\n',
    };
  },
  coverage: ({ facts }) => ({
    name: 'source files',
    count: facts.reduce((sum, entry) => sum + entry.total, 0),
  }),
});

const makefileTargetsRenderer = defineRenderer({
  id: 'makefile-targets',
  collect: () => collectMakefileTargets(),
  render: ({ context, facts }) => {
    const rows = facts.map(target => {
      return `| \`make ${target.name}\` | ${target.deps ? `\`${target.deps}\`` : '-'} | ${target.description || '-'} |`;
    });

    return {
      path: stringOption({ context, key: 'path', fallback: 'reference/makefile-targets.md' }),
      content:
        context.page.header({
          title: 'Makefile targets',
          description: 'Every make target, its prerequisites, and what it does (generated).',
          resource: 'Makefile',
          tags: ['reference', 'make', 'build'],
        }) +
        context.page.note({
          seeAlso: stringOption({
            context,
            key: 'seeAlso',
            fallback: 'Playbook: [build system](/process/build-system.md).',
          }),
        }) +
        `**${facts.length} targets.**\n\n` +
        ['| Target | Depends on | Description |', '|---|---|---|', ...rows].join('\n') +
        '\n',
    };
  },
  coverage: ({ facts }) => ({ name: 'make targets', count: facts.length }),
});

/** `options.source` is required: the one file that declares the keys. */
const bindingKeysSource = (opts: { context: IRenderContext }): string => {
  const source = opts.context.options.source;

  if (typeof source !== 'string') {
    throw new Error(
      'okf: renderer binding-keys needs options.source (the file that declares the keys)',
    );
  }

  return source;
};

const bindingKeysRenderer = defineRenderer({
  id: 'binding-keys',
  collect: ({ context }) =>
    collectBindingKeys({ file: join(context.root, bindingKeysSource({ context })) }),
  render: ({ context, facts }) => {
    const total = facts.reduce((sum, entry) => sum + entry.keys.length, 0);

    const body = facts
      .map(entry => {
        const rows = entry.keys.map(key => `| \`${key.key}\` | \`${key.value}\` |`);

        return [`## ${entry.name}`, '', '| Constant | Key |', '|---|---|', ...rows].join('\n');
      })
      .join('\n\n');

    return {
      path: stringOption({ context, key: 'path', fallback: 'reference/binding-keys.md' }),
      content:
        context.page.header({
          title: 'Binding keys',
          description: stringOption({
            context,
            key: 'description',
            fallback: 'Every dependency-injection binding key declared in the kernel (generated).',
          }),
          resource: bindingKeysSource({ context }),
          tags: ['reference', 'bindings', 'di'],
        }) +
        context.page.note({
          seeAlso: stringOption({
            context,
            key: 'seeAlso',
            fallback:
              'Namespaces: [binding key namespaces](/conventions/binding-key-namespaces.md).',
          }),
        }) +
        `**${total} keys across ${facts.length} binding classes.**\n\n` +
        (body || '_(none found)_') +
        '\n',
    };
  },
  coverage: ({ facts }) => ({
    name: 'binding keys',
    count: facts.reduce((sum, entry) => sum + entry.keys.length, 0),
  }),
});

/** Region only: one row per package directory, linked to its concept. */
const packagesTableRenderer = defineRenderer({
  id: 'packages-table',
  collect: () => collectPackageManifests(),
  region: ({ facts }) => {
    const rows = facts.map(entry => {
      return `| [\`${entry.dir}\`](/packages/${entry.dir}.md) | \`${entry.name}\` | ${entry.description || '-'} |`;
    });

    return ['| Package | npm name | Description |', '|---|---|---|', ...rows].join('\n');
  },
});

/** The renderers okf ships; anything else is a project module (`okf.renderers[].module`). */
export const BUILT_IN_RENDERERS: Record<string, IRenderer> = {
  [sourceMapRenderer.id]: sourceMapRenderer,
  [makefileTargetsRenderer.id]: makefileTargetsRenderer,
  [bindingKeysRenderer.id]: bindingKeysRenderer,
  [packagesTableRenderer.id]: packagesTableRenderer,
};
