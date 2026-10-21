import type { IAtlasPreset, IAtlasProject } from '@/common/project-config';
import type { IToolHandler } from '@/protocol/common';
import { dirname } from 'node:path';
import { z } from 'zod';
import { parseInput, PresetsInputSchema, ToolTriggers } from './common';

const DESCRIPTION =
  'Lists the presets this project can create from, the folder each one lands in and the exact ' +
  '`vulcan add` command for the `kind` you ask (app by default, lib for a shared package). When ' +
  'no preset fits the kind it says so plainly: then ask the user, never hand-write the package.';

const INPUT_JSON_SCHEMA = z.toJSONSchema(PresetsInputSchema);

const ADD = 'bun x --no-install vulcan add';
const NO_HAND_WRITING = 'do not hand-write package.json, tsconfig or scripts';

interface IPresetEntry {
  preset: string;
  side?: string;
  summary: string;
  folder: string | null;
  command: string;
}

/** The folder an app of this side lands in: the layout's, or nothing (never invented). */
const appFolderOf = (opts: { project: IAtlasProject; side: IAtlasPreset['side'] }): string | null =>
  opts.project.layout?.[opts.side] ?? null;

/** The folder a library lands in: the layout's shared folder, else the one folder the existing libraries share. */
const libFolderOf = (opts: { project: IAtlasProject }): string | null => {
  const folders = [
    ...new Set(
      opts.project.packages
        .filter(entry => entry.kind === 'lib' && !entry.retired)
        .map(entry => dirname(entry.path)),
    ),
  ];

  return opts.project.layout?.shared ?? (folders.length === 1 ? folders[0] : null);
};

const appEntry = (opts: {
  project: IAtlasProject;
  preset: IAtlasPreset;
  name: string;
}): IPresetEntry => {
  const { preset } = opts;
  const folder = appFolderOf({ project: opts.project, side: preset.side });
  const dirFlag = folder === null ? ` --${preset.side}-dir <folder>` : '';
  const api = preset.side === 'frontend' ? ' --api <backend app> | --no-api' : '';

  return {
    preset: preset.spec,
    side: preset.side,
    summary: preset.summary,
    folder,
    command: `${ADD} --preset ${preset.spec} --app ${opts.name}${dirFlag}${api}`,
  };
};

const libEntry = (opts: {
  project: IAtlasProject;
  preset: IAtlasPreset;
  name: string;
}): IPresetEntry => {
  const folder = libFolderOf({ project: opts.project });

  return {
    preset: opts.preset.spec,
    summary: opts.preset.lib ?? opts.preset.summary,
    folder,
    command: `${ADD} --preset ${opts.preset.spec} --lib ${opts.name}${folder === null ? ' --dir <folder>' : ''}`,
  };
};

/**
 * The presets of this project for the kind asked, from the manifest `vulcan sync` renders: nothing is
 * read from `node_modules`, and a kind no recorded preset makes is said plainly, never filled with an
 * app preset or an invented command.
 */
export const buildPresetsTool = (opts: {
  project: IAtlasProject | undefined;
  projects?: string;
}): IToolHandler => ({
  definition: {
    name: 'presets',
    description: `${ToolTriggers.presets({ projects: opts.projects ?? opts.project?.name })} ${DESCRIPTION}`,
    inputSchema: INPUT_JSON_SCHEMA,
  },
  call: async ({ args }) => {
    const input = parseInput({ schema: PresetsInputSchema, args });
    const kind = input.kind ?? 'app';
    const name = input.name ?? '<name>';
    const { project } = opts;

    if (kind !== 'app' && kind !== 'lib') {
      return {
        kind,
        presets: [],
        note: `no preset makes a ${kind} (vulcan add makes apps and libs): ask the user how it should be made; ${NO_HAND_WRITING}, and do not use an app or lib preset for it`,
      };
    }

    const recorded = project?.presets ?? [];

    if (recorded.length === 0) {
      return {
        kind,
        presets: [],
        note: 'this project has no recorded preset: ask the user which preset to use; the form is `vulcan add --preset <name|file:path> --app <name>` (--lib <name> for a shared package)',
      };
    }

    const entries =
      project === undefined
        ? []
        : kind === 'app'
          ? recorded
              .filter(preset => input.side === undefined || preset.side === input.side)
              .map(preset => appEntry({ project, preset, name }))
          : recorded
              .filter(preset => preset.lib !== undefined)
              .map(preset => libEntry({ project, preset, name }));

    return entries.length === 0
      ? {
          kind,
          presets: [],
          note: `no recorded preset makes a ${kind}: ask the user which preset to use, or how it should be made; ${NO_HAND_WRITING}, and do not use an app preset for it`,
        }
      : { kind, presets: entries };
  },
});
