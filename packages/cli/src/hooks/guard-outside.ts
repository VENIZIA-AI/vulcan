import { lstatSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { ShellParser, ShellUnread } from './shell.ts';
import { ShellFolders } from './shell-folders.ts';
import type { TEnvironment } from './shell-folders.ts';
import { ShellWrites } from './shell-writes.ts';
import type { IWriteTarget } from './shell-writes.ts';
import { HookConstants } from './common/index.ts';
import { ProjectTmp } from './project-tmp.ts';
import type { IManifestHookInput, IOutsideHit } from './common/index.ts';

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** The links one path may pass through before it is taken for a loop, as the OS counts them. */
const MAX_LINKS = 40;

/** The components of a path, without the empty and `.` ones, last first, so `pop` takes the next. */
const partsOf = (opts: { path: string }): string[] =>
  opts.path
    .split('/')
    .filter((part) => part !== '' && part !== '.')
    .reverse();

/**
 * The file the OS opens for an absolute path that has not been folded: each component in turn, a symlink
 * followed where it stands, so a `..` after a link goes to the parent of the link's target and not to the
 * parent of the link. What does not exist is kept as text, a dangling link followed to where it points. A path
 * that goes through more links than the OS follows has no file: `undefined`.
 */
const realOf = (opts: { path: string }): string | undefined => {
  const pending = partsOf({ path: opts.path });
  let current = '/';
  let links = 0;

  while (pending.length > 0) {
    const part = pending.pop() ?? '';

    if (part === '..') {
      current = dirname(current);
      continue;
    }

    const next = join(current, part);
    let target: string | undefined;

    try {
      target = lstatSync(next).isSymbolicLink() ? readlinkSync(next) : undefined;
    } catch {
      target = undefined;
    }

    if (target === undefined) {
      current = next;
      continue;
    }

    links += 1;

    if (links > MAX_LINKS) {
      return undefined;
    }

    if (isAbsolute(target)) {
      current = '/';
    }

    pending.push(...partsOf({ path: target }));
  }

  return current;
};
/** The files that name a process by number or as `self`: their target depends on who opens them. */
const PROCESS_FILES = /^\/(?:proc(?:\/|$)|dev\/fd(?:\/|$))/;

const isInside = (opts: { path: string; root: string }): boolean =>
  opts.path === opts.root || opts.path.startsWith(`${opts.root}${sep}`);

/**
 * A tool-owned pattern as an absolute glob: `~` and variables expanded, a bare directory taking everything
 * below it. A pattern with an unset variable is dropped - it would otherwise match from the root.
 */
const allowPatterns = (opts: { patterns: string[]; home: string; env: TEnvironment }): string[] =>
  opts.patterns.flatMap((pattern) => {
    if ((pattern === '~' || pattern.startsWith('~/')) && opts.home === '') {
      return [];
    }

    const withHome =
      pattern === '~' || pattern.startsWith('~/') ? `${opts.home}${pattern.slice(1)}` : pattern;
    let unresolved = false;
    const concrete = withHome.replace(/\$\{?(\w+)\}?/g, (_, name: string) => {
      const value = opts.env[name];

      if (value === undefined || value === '') {
        unresolved = true;
      }

      return value ?? '';
    });

    if (unresolved || !isAbsolute(concrete)) {
      return [];
    }

    return [concrete, /[*?[]/.test(concrete) ? concrete : `${concrete}/**`];
  });

const matchesAny = (opts: { path: string; patterns: string[] }): boolean =>
  opts.patterns.some((pattern) => new Bun.Glob(pattern).match(opts.path));

/**
 * The folder a bare `mktemp` uses in the command: the `TMPDIR` this hook runs with (Claude Code started
 * with the launch file or the variables), else the project's own folder when Claude Code's session-start
 * hook exports it (`CLAUDE_PROJECT_DIR` is set only by Claude Code), else the system temp directory.
 */
const commandTmpdirOf = (opts: { env: TEnvironment; projectRoot: string }): string => {
  if (opts.env.TMPDIR !== undefined && opts.env.TMPDIR !== '') {
    return opts.env.TMPDIR;
  }

  return opts.env.CLAUDE_PROJECT_DIR === undefined
    ? tmpdir()
    : ProjectTmp.projectOf({ root: opts.projectRoot });
};

export class OutsideGuard {
  /**
   * Every file, worktree, clone or temp file `input` would create outside the project. Files a package
   * manager, a runtime or the agent tool manage themselves are allowed (`toolOwnedPaths`, extending the
   * defaults); pointing `TMPDIR` or `mktemp` at the system temp directory is not. It reads common
   * forms - redirects, mkdir, cp, mv, tee, curl -o, git clone, git worktree add, mktemp, `cd` - and is a
   * guard against drift, not a sandbox: a path it cannot work out (an unset variable, a glob) passes.
   */
  static inspect(opts: {
    input: IManifestHookInput;
    projectRoot: string;
    toolOwnedPaths?: string[];
    home?: string;
    env?: TEnvironment;
  }): IOutsideHit[] {
    const env = opts.env ?? process.env;
    const home = opts.home ?? env.HOME ?? '';
    const root = realOf({ path: resolve(opts.projectRoot) }) ?? resolve(opts.projectRoot);
    const patterns = allowPatterns({
      patterns: [...HookConstants.TOOL_OWNED_PATHS, ...(opts.toolOwnedPaths ?? [])],
      home,
      env,
    });
    const start = resolve(opts.input.cwd ?? opts.projectRoot);
    // `$PWD` is the call's folder only when the host said which one it is; otherwise the hook's own `PWD` stays the fallback.
    const startPwd = opts.input.cwd === undefined ? undefined : start;
    const tmp = commandTmpdirOf({ env, projectRoot: opts.projectRoot });
    const targets: IWriteTarget[] = [];

    if (FILE_TOOLS.has(opts.input.tool) && opts.input.filePath !== undefined) {
      targets.push({
        word: opts.input.filePath,
        base: start,
        pwd: startPwd,
        message: `${opts.input.tool} writes ${opts.input.filePath}`,
      });
    }

    let unread: string | undefined;
    let assigned = new Set<string>();

    if (opts.input.command !== undefined) {
      const parsed = ShellParser.parseChecked({ command: opts.input.command });
      const folders = ShellFolders.foldersOf({
        commands: parsed.commands,
        cwd: start,
        pwd: startPwd,
        home,
        env,
      });

      unread = ShellUnread.reasonOf(parsed);
      assigned = ShellFolders.assignedNames({ commands: parsed.commands });

      // A command's own redirects open in the folder it starts in, a `cd`'s included.
      for (const [index, command] of parsed.commands.entries()) {
        const folder = folders[index];

        if (folder === undefined) {
          continue;
        }

        targets.push(
          ...ShellWrites.targetsOf({ command, base: folder.base, tmp }).map((target) => ({
            ...target,
            pwd: folder.pwd,
            vars: folder.vars,
            isKnown: folder.isKnown,
          })),
        );
      }
    }

    // Part of the line was not read: never an allow.
    const hits: IOutsideHit[] =
      unread === undefined
        ? []
        : [
            {
              path: '(the command line)',
              message: unread,
              isAgentToolScratchpad: false,
              isUnread: true,
            },
          ];

    for (const target of targets) {
      if (target.hasUnreadBrace === true) {
        hits.push({
          path: target.word,
          message: `${target.message}: the word has a brace pattern this check cannot expand`,
          isAgentToolScratchpad: false,
          isUnread: true,
        });
      }

      const expanded = ShellFolders.expandPath({
        word: target.word,
        home,
        env: { ...env, ...target.vars },
        cwd: target.pwd,
      });

      if (expanded === undefined) {
        // Part of the word is unknown, but the folder in front of it may not be: that folder decides.
        const lands = ShellFolders.folderOfUnknown({
          word: target.word,
          home,
          env: { ...env, ...target.vars },
          cwd: target.pwd,
          base: target.base,
          isKnown: target.isKnown ?? true,
          assigned,
        });
        const folder = lands === undefined ? undefined : realOf({ path: lands });

        if (
          folder !== undefined &&
          !isInside({ path: folder, root }) &&
          !matchesAny({ path: `${folder}/x`, patterns })
        ) {
          hits.push({
            path: folder,
            message: `${target.message}: it lands in ${folder}, outside the project, whatever the expansion is`,
            isAgentToolScratchpad: matchesAny({
              path: folder,
              patterns: HookConstants.AGENT_TOOL_SCRATCHPAD_PATTERNS,
            }),
            isUnread: false,
          });

          continue;
        }

        // A redirect to a word that cannot be worked out (`> $f`, `&>$fd`, `>&$fd`) may write a file outside the project.
        if (target.isAmbiguous === true || target.isRedirect === true) {
          hits.push({
            path: target.word,
            message: `${target.message}: the target has an expansion this check cannot work out`,
            isAgentToolScratchpad: false,
            isUnread: true,
          });
        }

        continue;
      }

      const written = isAbsolute(expanded) ? expanded : `${target.base}/${expanded}`;

      // `/proc/self` and `/dev/fd` name the hook's own process, not the shell the command runs in.
      if (PROCESS_FILES.test(written)) {
        hits.push({
          path: written,
          message: `${target.message}: a path under /proc or /dev/fd names a process, which this check cannot follow`,
          isAgentToolScratchpad: false,
          isUnread: true,
        });

        continue;
      }

      // Not folded here: a `..` after a symlink goes where the link points, which `realOf` follows.
      const path = realOf({ path: written });

      if (path === undefined) {
        hits.push({
          path: written,
          message: `${target.message}: the path goes through more links than the system follows`,
          isAgentToolScratchpad: false,
          isUnread: true,
        });

        continue;
      }

      if (!isInside({ path, root }) && !matchesAny({ path, patterns })) {
        hits.push({
          path,
          message: target.message,
          isAgentToolScratchpad: matchesAny({
            path,
            patterns: HookConstants.AGENT_TOOL_SCRATCHPAD_PATTERNS,
          }),
          isUnread: false,
        });
      }
    }

    return hits;
  }
}
