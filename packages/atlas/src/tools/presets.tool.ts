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
  '`vulcan add` command for the `kind` you ask (app by default, lib for a library other apps import, shared ' +
  'for a side-neutral package other apps import): the ' +
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
  /** The one folder it lands in; null when the layout names none or several (then `folders` lists them). */
  folder: string | null;
  /** Every folder the layout lists for this kind, when there is more than one: name one with the folder flag. */
  folders?: string[];
  command: string;
  /** `true` for a preset this project recorded; `false` for an official one it has not used yet. */
  inProject: boolean;
}

/** A layout value as a list: one folder, several, or none. */
const listOf = (opts: { value: string | string[] | undefined }): string[] =>
  opts.value === undefined ? [] : typeof opts.value === 'string' ? [opts.value] : opts.value;

/** The folders an app of this side can land in: the layout's, or none (never invented). */
const appFoldersOf = (opts: {
  project: IAtlasProject | undefined;
  side: IAtlasPreset['side'];
}): string[] => listOf({ value: opts.project?.layout?.[opts.side] });

/** The folders a library can land in: the layout's shared folders, else the one folder the existing libraries share. */
const libFoldersOf = (opts: { project: IAtlasProject | undefined }): string[] => {
  const shared = listOf({ value: opts.project?.layout?.shared });

  if (shared.length > 0) {
    return shared;
  }

  const folders = [
    ...new Set(
      (opts.project?.packages ?? [])
        .filter((entry) => entry.kind === 'lib' && !entry.retired)
        .map((entry) => dirname(entry.path)),
    ),
  ];

  return folders.length === 1 ? folders : [];
};

/** The folder flag of a command: nothing when the layout names the one folder, a placeholder (with the list) otherwise. */
const folderFlagOf = (opts: { flag: string; folders: string[] }): string =>
  opts.folders.length === 1
    ? ''
    : ` ${opts.flag} <${opts.folders.length === 0 ? 'folder' : opts.folders.join('|')}>`;

const appEntry = (opts: {
  project: IAtlasProject | undefined;
  spec: string;
  side: IAtlasPreset['side'];
  summary: string;
  name: string;
  inProject: boolean;
}): IPresetEntry => {
  const folders = appFoldersOf({ project: opts.project, side: opts.side });
  const dirFlag = folderFlagOf({ flag: `--${opts.side}-dir`, folders });
  const api = opts.side === 'frontend' ? ' --api <backend app> | --no-api' : '';

  return {
    preset: opts.spec,
    side: opts.side,
    summary: opts.summary,
    folder: folders.length === 1 ? (folders[0] ?? null) : null,
    ...(folders.length > 1 ? { folders } : {}),
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
  /** `lib` (the default) or the side-neutral `shared`: the flag of the command. */
  kind?: 'lib' | 'shared';
}): IPresetEntry => {
  const folders = libFoldersOf({ project: opts.project });

  return {
    preset: opts.spec,
    summary: opts.summary,
    folder: folders.length === 1 ? (folders[0] ?? null) : null,
    ...(folders.length > 1 ? { folders } : {}),
    command: `${ADD} --preset ${opts.spec} --${opts.kind ?? 'lib'} ${opts.name}${folderFlagOf({ flag: '--dir', folders })}`,
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

    if (kind !== 'app' && kind !== 'lib' && kind !== 'shared') {
      return {
        kind,
        presets: [],
        note: `no preset makes a ${kind} (vulcan add makes apps, libs and shared packages): ask the user how it should be made; ${NO_HAND_WRITING}, and do not use an app, lib or shared preset for it`,
      };
    }

    const recorded = project?.presets ?? [];
    const fits = (side: IAtlasPreset['side']): boolean =>
      input.side === undefined || side === input.side;
    const entries: IPresetEntry[] =
      kind === 'app'
        ? [
            ...recorded
              .filter((preset) => fits(preset.side))
              .map((preset) =>
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
              (official) =>
                fits(official.side) &&
                !recorded.some((preset) => officialIdOf({ spec: preset.spec }) === official.id),
            ).map((official) =>
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
        : kind === 'lib'
          ? [
              ...recorded
                .filter((preset) => preset.lib !== undefined)
                .map((preset) =>
                  libEntry({
                    project,
                    spec: preset.spec,
                    summary: preset.lib ?? preset.summary,
                    name,
                    inProject: true,
                  }),
                ),
              ...OFFICIAL_PRESETS.filter(
                (official) =>
                  !recorded.some(
                    (preset) =>
                      officialIdOf({ spec: preset.spec }) === official.id &&
                      preset.lib !== undefined,
                  ),
              ).map((official) =>
                libEntry({
                  project,
                  spec: official.id,
                  summary: official.lib,
                  name,
                  inProject: false,
                }),
              ),
            ]
          : [
              ...recorded
                .filter((preset) => preset.shared !== undefined)
                .map((preset) =>
                  libEntry({
                    project,
                    spec: preset.spec,
                    summary: preset.shared ?? preset.summary,
                    name,
                    inProject: true,
                    kind: 'shared',
                  }),
                ),
              ...OFFICIAL_PRESETS.flatMap((official) =>
                official.shared !== undefined &&
                !recorded.some(
                  (preset) =>
                    officialIdOf({ spec: preset.spec }) === official.id &&
                    preset.shared !== undefined,
                )
                  ? [
                      libEntry({
                        project,
                        spec: official.id,
                        summary: official.shared,
                        name,
                        inProject: false,
                        kind: 'shared',
                      }),
                    ]
                  : [],
              ),
            ];

    if (entries.length === 0) {
      return {
        kind,
        presets: [],
        note: `no preset makes a ${kind}: ask the user how it should be made; ${NO_HAND_WRITING}, and do not use an app preset for it`,
      };
    }

    if (entries.some((entry) => entry.inProject)) {
      return { kind, presets: entries };
    }

    return {
      kind,
      presets: entries,
      note:
        recorded.length === 0
          ? 'this project recorded no preset: the entries are the official ones, marked inProject false; ask the user which to use'
          : `no recorded preset makes a ${kind === 'app' ? (input.side ?? 'app') : kind}: the entries are the official ones, marked inProject false; ask the user which to use, and ${NO_HAND_WRITING}`,
    };
  },
});
