import type { IAtlasPreset, IAtlasProject } from '@/common/project-config';
import type { IToolHandler } from '@/protocol/common';
import { dirname } from 'node:path';
import { z } from 'zod';
import {
  OFFICIAL_PRESETS,
  officialIdOf,
  parseInput,
  PresetsInputSchema,
  ToolTriggers,
} from './common';

const DESCRIPTION =
  'Lists the presets this project can create from, the folder each one lands in and the exact ' +
  '`vulcan add` command for the `kind` you ask (app by default, lib for a shared package): the ' +
  'presets this project recorded first, then the official ones it has not used yet, marked ' +
  '`inProject: false`. When no preset fits the kind it says so plainly: then ask the user, never ' +
  'hand-write the package.';

const INPUT_JSON_SCHEMA = z.toJSONSchema(PresetsInputSchema);

const ADD = 'bun x --no-install vulcan add';
const NO_HAND_WRITING = 'do not hand-write package.json, tsconfig or scripts';

interface IPresetEntry {
  preset: string;
  side?: string;
  summary: string;
  folder: string | null;
  command: string;
  /** `true` for a preset this project recorded; `false` for an official one it has not used yet. */
  inProject: boolean;
}

/** The folder an app of this side lands in: the layout's, or nothing (never invented). */
const appFolderOf = (opts: {
  project: IAtlasProject | undefined;
  side: IAtlasPreset['side'];
}): string | null => opts.project?.layout?.[opts.side] ?? null;

/** The folder a library lands in: the layout's shared folder, else the one folder the existing libraries share. */
const libFolderOf = (opts: { project: IAtlasProject | undefined }): string | null => {
  const folders = [
    ...new Set(
      (opts.project?.packages ?? [])
        .filter(entry => entry.kind === 'lib' && !entry.retired)
        .map(entry => dirname(entry.path)),
    ),
  ];

  return opts.project?.layout?.shared ?? (folders.length === 1 ? folders[0] : null);
};

const appEntry = (opts: {
  project: IAtlasProject | undefined;
  spec: string;
  side: IAtlasPreset['side'];
  summary: string;
  name: string;
  inProject: boolean;
}): IPresetEntry => {
  const folder = appFolderOf({ project: opts.project, side: opts.side });
  const dirFlag = folder === null ? ` --${opts.side}-dir <folder>` : '';
  const api = opts.side === 'frontend' ? ' --api <backend app> | --no-api' : '';

  return {
    preset: opts.spec,
    side: opts.side,
    summary: opts.summary,
    folder,
    command: `${ADD} --preset ${opts.spec} --app ${opts.name}${dirFlag}${api}`,
    inProject: opts.inProject,
  };
};

const libEntry = (opts: {
  project: IAtlasProject | undefined;
  spec: string;
  summary: string;
  name: string;
  inProject: boolean;
}): IPresetEntry => {
  const folder = libFolderOf({ project: opts.project });

  return {
    preset: opts.spec,
    summary: opts.summary,
    folder,
    command: `${ADD} --preset ${opts.spec} --lib ${opts.name}${folder === null ? ' --dir <folder>' : ''}`,
    inProject: opts.inProject,
  };
};

/**
 * The presets of this project for the kind asked, from the manifest `vulcan sync` renders: nothing is
 * read from `node_modules`. The recorded presets come first; the official ones the project has not
 * used follow, marked `inProject: false`, so an agent never concludes that no frontend preset exists
 * because the project has none yet. A kind no preset makes is said plainly, never filled with an app
 * preset or an invented command.
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
    const fits = (side: IAtlasPreset['side']): boolean =>
      input.side === undefined || side === input.side;
    const entries: IPresetEntry[] =
      kind === 'app'
        ? [
            ...recorded
              .filter(preset => fits(preset.side))
              .map(preset =>
                appEntry({
                  project,
                  spec: preset.spec,
                  side: preset.side,
                  summary: preset.summary,
                  name,
                  inProject: true,
                }),
              ),
            ...OFFICIAL_PRESETS.filter(
              official =>
                fits(official.side) &&
                !recorded.some(preset => officialIdOf({ spec: preset.spec }) === official.id),
            ).map(official =>
              appEntry({
                project,
                spec: official.id,
                side: official.side,
                summary: official.summary,
                name,
                inProject: false,
              }),
            ),
          ]
        : [
            ...recorded
              .filter(preset => preset.lib !== undefined)
              .map(preset =>
                libEntry({
                  project,
                  spec: preset.spec,
                  summary: preset.lib ?? preset.summary,
                  name,
                  inProject: true,
                }),
              ),
            ...OFFICIAL_PRESETS.filter(
              official =>
                !recorded.some(
                  preset =>
                    officialIdOf({ spec: preset.spec }) === official.id && preset.lib !== undefined,
                ),
            ).map(official =>
              libEntry({
                project,
                spec: official.id,
                summary: official.lib,
                name,
                inProject: false,
              }),
            ),
          ];

    if (entries.length === 0) {
      return {
        kind,
        presets: [],
        note: `no preset makes a ${kind}: ask the user how it should be made; ${NO_HAND_WRITING}, and do not use an app preset for it`,
      };
    }

    if (entries.some(entry => entry.inProject)) {
      return { kind, presets: entries };
    }

    return {
      kind,
      presets: entries,
      note:
        recorded.length === 0
          ? 'this project recorded no preset: the entries are the official ones, marked inProject false; ask the user which to use'
          : `no recorded preset makes a ${kind === 'lib' ? 'lib' : (input.side ?? 'app')}: the entries are the official ones, marked inProject false; ask the user which to use, and ${NO_HAND_WRITING}`,
    };
  },
});
