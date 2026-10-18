import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { BASE_DIRECTORY, stableBaseDirectoryOf } from '../common/index.ts';
import { CodingAgents } from '../config/index.ts';
import type { TResolvedConfig } from '../config/index.ts';
import { ManifestConstants, renderManifest } from '../manifest/index.ts';
import { readSlots } from '../rules/index.ts';
import { SyncConstants, SyncStatuses } from './common/index.ts';
import type { ISyncAction, TSettings } from './common/index.ts';
import {
  buildProjectHookSettings,
  isSettingsObject,
  keepKeyOrder,
  mergeSettings,
  removeManagedSettings,
} from './settings.ts';

const NO_CHANGE = (): void => {};

const isSymlink = (opts: { path: string }): boolean =>
  lstatSync(opts.path, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;

/** `CLAUDE.md` holds only `@AGENTS.md`: an old symlink is replaced, a hand-written file is left alone. */
const planClaudeImport = (opts: { root: string }): ISyncAction => {
  const path = join(opts.root, SyncConstants.CLAUDE_TOOL_FILE);
  const write = (): void => writeFileSync(path, `${SyncConstants.CLAUDE_IMPORT_LINE}\n`);

  if (isSymlink({ path })) {
    return {
      path,
      status: SyncStatuses.REPLACED,
      note: 'old symlink',
      apply: () => {
        rmSync(path);
        write();
      },
    };
  }

  if (!existsSync(path)) {
    return { path, status: SyncStatuses.CREATED, apply: write };
  }

  return readFileSync(path, 'utf8').trim() === SyncConstants.CLAUDE_IMPORT_LINE
    ? { path, status: SyncStatuses.UNCHANGED, apply: NO_CHANGE }
    : {
        path,
        status: SyncStatuses.SKIPPED,
        note: `hand-written - delete it to let sync write '${SyncConstants.CLAUDE_IMPORT_LINE}'`,
        apply: NO_CHANGE,
      };
};

const readSettingsFile = (opts: { path: string }): TSettings | undefined => {
  if (!existsSync(opts.path)) {
    return {};
  }

  try {
    const parsed = { value: JSON.parse(readFileSync(opts.path, 'utf8')) };

    return isSettingsObject(parsed) ? parsed.value : undefined;
  } catch (error) {
    console.error(
      `[readSettingsFile] ${opts.path} | ${error instanceof Error ? error.message : String(error)}`,
    );

    return undefined;
  }
};

/** Shipped settings, the chosen slot options, the project's hooks and `claude.settings` - what sync owns. */
const buildManagedOverlay = (opts: { config: TResolvedConfig }): TSettings => {
  let overlay: TSettings = JSON.parse(
    readFileSync(join(BASE_DIRECTORY, 'claude', SyncConstants.SETTINGS_FILE), 'utf8'),
  );

  for (const [id, slot] of Object.entries(readSlots())) {
    const choice = opts.config.rules[id];
    const settings = choice === undefined ? undefined : slot.options[choice]?.settings;

    if (settings !== undefined) {
      overlay = mergeSettings({ base: overlay, overlay: settings });
    }
  }

  if (opts.config.remoteHosts !== undefined) {
    overlay = mergeSettings({
      base: overlay,
      overlay: JSON.parse(
        readFileSync(join(BASE_DIRECTORY, 'claude', SyncConstants.REMOTE_HOSTS_FILE), 'utf8'),
      ),
    });
  }

  overlay = mergeSettings({
    base: overlay,
    overlay: buildProjectHookSettings({ hooks: opts.config.hooks }),
  });

  return mergeSettings({ base: overlay, overlay: opts.config.claude.settings });
};

/** The previous overlay is taken back before the new one merges in, so removed choices really disappear. */
const planSettings = (opts: { root: string; config: TResolvedConfig }): ISyncAction => {
  const directory = join(opts.root, SyncConstants.CLAUDE_DIRECTORY);
  const path = join(directory, SyncConstants.SETTINGS_FILE);
  const managedPath = join(directory, SyncConstants.MANAGED_FILE);
  const current = readSettingsFile({ path });

  if (current === undefined) {
    return {
      path,
      status: SyncStatuses.SKIPPED,
      note: 'not valid JSON (or not an object) - left untouched; fix it, then re-run sync',
      apply: NO_CHANGE,
    };
  }

  const previous = readSettingsFile({ path: managedPath }) ?? {};
  const overlay = buildManagedOverlay({ config: opts.config });
  const merged = mergeSettings({
    base: removeManagedSettings({ settings: current, managed: previous }),
    overlay,
  });

  const wanted = keepKeyOrder({ settings: merged, reference: current });

  const text = `${JSON.stringify(wanted, null, 2)}\n`;
  const managedText = `${JSON.stringify(overlay, null, 2)}\n`;
  const before = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  const managedBefore = existsSync(managedPath) ? readFileSync(managedPath, 'utf8') : undefined;

  if (before === text && managedBefore === managedText) {
    return { path, status: SyncStatuses.UNCHANGED, apply: NO_CHANGE };
  }

  return {
    path,
    status: before === undefined ? SyncStatuses.CREATED : SyncStatuses.REPLACED,
    note: 'shipped, slot, project hooks and claude.settings over personal keys',
    apply: () => {
      mkdirSync(directory, { recursive: true });
      writeFileSync(path, text);
      writeFileSync(managedPath, managedText);
    },
  };
};

const findSkillDirectories = (opts: { directory: string }): string[] =>
  existsSync(opts.directory)
    ? readdirSync(opts.directory, { withFileTypes: true })
        .filter(
          entry =>
            entry.isDirectory() &&
            existsSync(join(opts.directory, entry.name, SyncConstants.SKILL_FILE)),
        )
        .map(entry => join(opts.directory, entry.name))
    : [];

/** Shipped and project skills, linked flat into `.claude/skills/<name>`; a real directory there is left alone. */
const planSkillLinks = (opts: { root: string }): ISyncAction[] => {
  const target = join(opts.root, SyncConstants.CLAUDE_DIRECTORY, SyncConstants.SKILLS_DIRECTORY);

  // A symlinked skills directory points outside the project: writing links through it would land them there.
  if (isSymlink({ path: target })) {
    return [
      {
        path: target,
        status: SyncStatuses.SKIPPED,
        note: 'a symlink - left untouched',
        apply: NO_CHANGE,
      },
    ];
  }

  const stableSkills = join(stableBaseDirectoryOf(opts), SyncConstants.SKILLS_DIRECTORY);
  const shipped = findSkillDirectories({
    directory: join(BASE_DIRECTORY, SyncConstants.SKILLS_DIRECTORY),
  }).map(source => join(stableSkills, basename(source)));
  const shippedNames = new Set(shipped.map(source => basename(source)));
  const project = findSkillDirectories({
    directory: join(opts.root, '.agents', SyncConstants.SKILLS_DIRECTORY),
  });

  // Extend only: a project skill never takes a shipped skill's link; doctor reports the clash.
  const shadowing: ISyncAction[] = project
    .filter(source => shippedNames.has(basename(source)))
    .map(source => ({
      path: source,
      status: SyncStatuses.SKIPPED,
      note: "shadows a shipped skill - rename it ('vulcan doctor' reports it)",
      apply: NO_CHANGE,
    }));
  const sources = [...shipped, ...project.filter(source => !shippedNames.has(basename(source)))];

  const links = sources.map((source): ISyncAction => {
    const path = join(target, basename(source));
    const link = (): void => {
      mkdirSync(target, { recursive: true });
      symlinkSync(resolve(source), path);
    };

    if (isSymlink({ path })) {
      return readlinkSync(path) === resolve(source)
        ? { path, status: SyncStatuses.UNCHANGED, apply: NO_CHANGE }
        : {
            path,
            status: SyncStatuses.REPLACED,
            apply: () => {
              rmSync(path);
              link();
            },
          };
    }

    return existsSync(path)
      ? {
          path,
          status: SyncStatuses.SKIPPED,
          note: 'a real directory - left untouched',
          apply: NO_CHANGE,
        }
      : { path, status: SyncStatuses.CREATED, apply: link };
  });

  // A link into the shipped skills whose skill this VULCAN no longer has (a downgrade, a retired
  // skill) is sync's own and dead: taken back. Any other link or directory stays.
  const shippedRoots = [stableSkills, join(BASE_DIRECTORY, SyncConstants.SKILLS_DIRECTORY)];
  const linked = new Set(sources.map(source => basename(source)));
  const stale = (existsSync(target) ? readdirSync(target) : [])
    .filter(name => !linked.has(name))
    .map(name => join(target, name))
    .filter(
      path =>
        isSymlink({ path }) &&
        !existsSync(path) &&
        shippedRoots.some(root => readlinkSync(path).startsWith(`${root}/`)),
    )
    .map((path): ISyncAction => ({
      path,
      status: SyncStatuses.REMOVED,
      note: 'a shipped skill this version no longer has',
      apply: () => rmSync(path),
    }));

  return [...links, ...shadowing, ...stale];
};

/** The committed project manifest (Project Contract v1, C1), rendered from the config. */
export const planManifest = (opts: { root: string; config: TResolvedConfig }): ISyncAction => {
  const path = join(opts.root, ManifestConstants.FILE);
  const text = renderManifest(opts);
  const write = (): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };

  if (!existsSync(path)) {
    return { path, status: SyncStatuses.CREATED, apply: write };
  }

  return readFileSync(path, 'utf8') === text
    ? { path, status: SyncStatuses.UNCHANGED, apply: NO_CHANGE }
    : { path, status: SyncStatuses.REPLACED, apply: write };
};

/** Every adapter the project's agents need, and the manifest every project carries - planned, not written. */
export const planSync = (opts: { root: string; config: TResolvedConfig }): ISyncAction[] => [
  ...(opts.config.agents.includes(CodingAgents.CLAUDE)
    ? [
        planClaudeImport({ root: opts.root }),
        planSettings(opts),
        ...planSkillLinks({ root: opts.root }),
      ]
    : []),
  planManifest(opts),
];
