import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IReadOnlyScript } from './common/index.ts';

/** A command the project says is a database write or a deploy: guard-writes asks on a match. */
export interface IProjectCommandCheck {
  rule: 'V-W-02' | 'V-W-03';
  what: string;
  pattern: RegExp;
}

/** What the project adds to the guards: the manifest's `guard` block, compiled. */
export interface IGuardPolicy {
  commands: IProjectCommandCheck[];
  askPush: string[];
  /** `guard.writes.readOnlyScripts`; absent when the manifest lists none. */
  readOnlyScripts?: IReadOnlyScript[];
}

/** Spelt out: the blocking hooks import nothing that reads the package (a test holds it equal to the manifest's name). */
export const GUARD_MANIFEST_FILE = '.agents/vulcan.manifest.json';

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

const ruleOf = (opts: { value: unknown }): 'V-W-02' | 'V-W-03' | undefined =>
  opts.value === 'V-W-02' || opts.value === 'V-W-03' ? opts.value : undefined;

const note = (opts: { message: string }): void => {
  console.error(`vulcan: [guard] ${opts.message}`);
};

const commandOf = (opts: { value: unknown }): IProjectCommandCheck | undefined => {
  const holder = { value: opts.value };

  if (!isRecord(holder)) {
    return undefined;
  }

  const rule = ruleOf({ value: holder.value['rule'] });
  const what = holder.value['what'];
  const source = holder.value['pattern'];

  if (rule === undefined || typeof what !== 'string' || what === '' || typeof source !== 'string') {
    note({
      message: 'ignoring a guard.writes.commands entry that has no usable rule, what or pattern',
    });

    return undefined;
  }

  try {
    return {
      rule,
      what,
      pattern: new RegExp(source, holder.value['ignoreCase'] === true ? 'i' : ''),
    };
  } catch (error) {
    note({
      message: `ignoring the pattern '${source}' of guard.writes.commands (${error instanceof Error ? error.message : String(error)})`,
    });

    return undefined;
  }
};

const readOnlyScriptOf = (opts: { value: unknown }): IReadOnlyScript | undefined => {
  const holder = { value: opts.value };
  const script = isRecord(holder) ? holder.value['script'] : undefined;
  const listed = isRecord(holder) ? holder.value['readOnly'] : undefined;
  const words = Array.isArray(listed)
    ? listed.filter((word): word is string => typeof word === 'string' && word !== '')
    : [];

  if (
    typeof script !== 'string' ||
    script === '' ||
    !Array.isArray(listed) ||
    words.length !== listed.length
  ) {
    note({
      message:
        'ignoring a guard.writes.readOnlyScripts entry that has no script or no readOnly list of words',
    });

    return undefined;
  }

  return { script, readOnly: words };
};

/**
 * The commands, push targets and read-only scripts a project lists, from the committed manifest (`vulcan sync` renders
 * them from the config), so a hook reads them with no config loader and no zod. A project with no
 * manifest, or none of the block, has none; an entry that cannot be used is skipped, said once on
 * stderr, and the others stay.
 */
export const readGuardPolicy = (opts: { root: string }): IGuardPolicy => {
  const path = join(opts.root, GUARD_MANIFEST_FILE);
  const empty: IGuardPolicy = { commands: [], askPush: [] };

  if (!existsSync(path)) {
    return empty;
  }

  let manifest: unknown;

  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    note({
      message: `the manifest could not be read, so the project's own patterns are off (${error instanceof Error ? error.message : String(error)})`,
    });

    return empty;
  }

  const top = { value: manifest };
  const guard = isRecord(top) ? { value: top.value['guard'] } : { value: undefined };

  if (!isRecord(guard)) {
    return empty;
  }

  const writes = { value: guard.value['writes'] };
  const git = { value: guard.value['git'] };
  const listed = isRecord(writes) ? writes.value['commands'] : undefined;
  const scripts = isRecord(writes) ? writes.value['readOnlyScripts'] : undefined;
  const targets = isRecord(git) ? git.value['askPush'] : undefined;
  const readOnlyScripts = (Array.isArray(scripts) ? scripts : []).flatMap((entry) => {
    const script = readOnlyScriptOf({ value: entry });

    return script === undefined ? [] : [script];
  });

  return {
    commands: (Array.isArray(listed) ? listed : []).flatMap((entry) => {
      const check = commandOf({ value: entry });

      return check === undefined ? [] : [check];
    }),
    askPush: (Array.isArray(targets) ? targets : []).filter(
      (target): target is string => typeof target === 'string' && target !== '',
    ),
    ...(readOnlyScripts.length === 0 ? {} : { readOnlyScripts }),
  };
};

/** Whether a branch name is one of the listed names; `*` stands for any run of characters, nothing else is special. */
export const matchesBranch = (opts: { name: string; patterns: string[] }): boolean =>
  opts.patterns.some((pattern) =>
    new RegExp(
      `^${pattern
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')}$`,
    ).test(opts.name),
  );
