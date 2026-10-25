import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { GuardDecisions, HookConstants } from './common/index.ts';
import type { IManifestHookInput } from './common/index.ts';
import { forHost } from './decision.ts';
import { LayoutKeys, validLayoutFolders } from '../common/layout-folder.ts';

const MANIFEST_FILE = '.agents/vulcan.manifest.json';
const PACKAGE_FILE = 'package.json';
const NODE_MODULES = 'node_modules';
const ADD = 'bun x --no-install vulcan add';
const NO_HAND_WRITING = 'do not hand-write package.json, tsconfig or scripts';

export interface IPackageVerdict {
  /** `deny` only when a real `vulcan add` command exists for the folder; otherwise `warn`. */
  kind: 'deny' | 'warn';
  message: string;
}

interface IRecordedPreset {
  spec: string;
  side: string;
  lib: boolean;
}

interface IProjectView {
  root: string;
  /** The valid folders of each managed key; `other` is not here: it is not guarded. */
  layout: Record<string, string[]>;
  presets: IRecordedPreset[];
}

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

/** The nearest project above `start`: the folder holding the generated manifest. */
const findRoot = (opts: { start: string }): string | undefined => {
  let current = opts.start;

  for (;;) {
    if (existsSync(join(current, MANIFEST_FILE))) {
      return current;
    }

    const parent = dirname(current);

    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
};

/** What the manifest says of layout and presets; `undefined` when it is missing or not readable. */
const readProject = (opts: { start: string }): IProjectView | undefined => {
  const root = findRoot({ start: opts.start });

  if (root === undefined) {
    return undefined;
  }

  let manifest: unknown;

  try {
    manifest = JSON.parse(readFileSync(join(root, MANIFEST_FILE), 'utf8'));
  } catch (error) {
    console.error(
      `[readProject] unreadable manifest - letting the call through | ${error instanceof Error ? error.message : String(error)}`,
    );

    return undefined;
  }

  const holder = { value: manifest };

  if (!isRecord(holder)) {
    return undefined;
  }

  const layoutHolder = { value: holder.value['layout'] };
  const layout: Record<string, string[]> = {};

  // The manifest is read through the same validator as the config: a folder that is not one is dropped.
  if (isRecord(layoutHolder)) {
    for (const key of LayoutKeys.MANAGED) {
      const folders = validLayoutFolders({ value: layoutHolder.value[key] });

      if (folders.length > 0) {
        layout[key] = folders;
      }
    }
  }

  const recorded = Array.isArray(holder.value['presets']) ? holder.value['presets'] : [];
  const presets = recorded.flatMap((item: unknown): IRecordedPreset[] => {
    const entry = { value: item };

    if (!isRecord(entry)) {
      return [];
    }

    const { spec, side, lib } = entry.value;

    return typeof spec === 'string' && typeof side === 'string'
      ? [{ spec, side, lib: typeof lib === 'string' }]
      : [];
  });

  return { root, layout, presets };
};

/** `services/api3` from `services/api3/package.json`, as the folder it sits in and its name. */
const newPackageOf = (opts: {
  root: string;
  path: string;
}): { folder: string; name: string } | undefined => {
  const parts = normalize(relative(opts.root, opts.path)).split(sep);

  if (parts.length < 3 || parts.includes('..') || parts.includes(NODE_MODULES)) {
    return undefined;
  }

  const name = parts[parts.length - 2];
  const folder = parts.slice(0, -2).join('/');

  return { folder, name };
};

const appCommand = (opts: { preset: IRecordedPreset; name: string; folderFlag: string }): string =>
  `${ADD} --preset ${opts.preset.spec} --app ${opts.name}${opts.folderFlag}${opts.preset.side === 'frontend' ? ' --api <backend app> | --no-api' : ''}`;

/**
 * Whether this tool call creates the `package.json` of a new app or shared package in one of the
 * project's layout folders. A real `vulcan add` command for that folder makes it a `deny`; with no
 * preset behind the folder it is only a `warn`: the guard never blocks without a command to offer.
 */
export const inspectPackageWrite = (opts: {
  input: IManifestHookInput;
}): IPackageVerdict | undefined => {
  const { tool, filePath, cwd } = opts.input;

  if (tool !== 'Write' || filePath === undefined || basename(filePath) !== PACKAGE_FILE) {
    return undefined;
  }

  const absolute = normalize(
    isAbsolute(filePath) ? filePath : join(cwd ?? process.cwd(), filePath),
  );

  if (absolute.split(sep).includes(NODE_MODULES) || existsSync(absolute)) {
    return undefined;
  }

  const project = readProject({ start: dirname(absolute) });
  const created =
    project === undefined ? undefined : newPackageOf({ root: project.root, path: absolute });

  if (project === undefined || created === undefined) {
    return undefined;
  }

  const entry = Object.entries(project.layout).find(([, folders]) =>
    folders.includes(created.folder),
  );

  if (entry === undefined) {
    return undefined;
  }

  const [key, folders] = entry;
  const isLib = key === 'shared';
  const what = isLib ? 'lib' : `${key} app`;
  // A side with several folders needs the one it is written in named, so the command is exact.
  const folderFlag =
    folders.length > 1 ? ` ${isLib ? '--dir' : `--${key}-dir`} ${created.folder}` : '';
  const commands = isLib
    ? project.presets
        .filter((preset) => preset.lib)
        .map((preset) => `${ADD} --preset ${preset.spec} --lib ${created.name}${folderFlag}`)
    : project.presets
        .filter((preset) => preset.side === key)
        .map((preset) => appCommand({ preset, name: created.name, folderFlag }));

  if (commands.length > 0) {
    return {
      kind: GuardDecisions.DENY,
      message: `${created.folder}/${created.name} is a new ${what}: create it with a preset, not by hand - run ${commands.join(' or ')} (ask atlas \`presets\` for the choice); ${NO_HAND_WRITING}`,
    };
  }

  return {
    kind: 'warn',
    message:
      project.presets.length === 0
        ? `${created.folder}/${created.name} looks like a new ${what} and this project recorded no preset: ask the user which preset to use (\`vulcan add --preset <name|file:path> --app <name>\`, --lib <name> for a shared package); ${NO_HAND_WRITING}`
        : `${created.folder}/${created.name} looks like a new ${what} but no recorded preset makes a ${what}: ask the user how it should be made; ${NO_HAND_WRITING}`,
  };
};

export const buildPackageDecision = (opts: { verdict: IPackageVerdict }) =>
  opts.verdict.kind === GuardDecisions.DENY
    ? forHost({
        output: {
          hookSpecificOutput: {
            hookEventName: HookConstants.PRE_TOOL_USE,
            permissionDecision: GuardDecisions.DENY,
            permissionDecisionReason: opts.verdict.message,
          },
        },
      })
    : {
        hookSpecificOutput: {
          hookEventName: HookConstants.PRE_TOOL_USE,
          additionalContext: opts.verdict.message,
        },
      };
