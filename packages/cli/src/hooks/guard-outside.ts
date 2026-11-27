import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { ShellParser, ShellUnread } from './shell.ts';
import { ShellFolders, loopCombinations } from './shell-folders.ts';
import { ShellPaths } from './shell-paths.ts';
import { ShellWrites } from './shell-writes.ts';
import { HookConstants } from './common/index.ts';
import { OutsidePaths } from './outside-paths.ts';
import { ProjectTmp } from './project-tmp.ts';
import type {
  IManifestHookInput,
  IOutsideHit,
  IWriteTarget,
  TEnvironment,
  TProtectedMode,
} from './common/index.ts';

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * A path of plain folders (no `..`) whose last name holds one `[...]` of plain characters: a VitePress route file such as
 * `content/[version].md`. Nothing else in it is a pattern, an expansion or a shell metacharacter (a zsh glob qualifier
 * needs one), and the only glob is in the last name.
 */
const BRACKET_NAME = /^\/?(?:(?!\.\.\/)[\w.-]+\/)*[\w.-]*\[[\w.-]+\][\w.-]*$/;

/** The files that name a process by number or as `self`: their target depends on who opens them. */
const PROCESS_FILES = /^\/(?:proc(?:\/|$)|dev\/fd(?:\/|$))/;

/**
 * Whether the `[...]` name of `word` (a `BRACKET_NAME`) matches no entry of its folder, so the shell takes it as written:
 * a match is written through, symlink and all, and is the existing file's business. An unreadable folder is not a miss.
 */
const matchesNothing = (opts: { word: string; base: string }): boolean => {
  const at = opts.word.lastIndexOf('/');
  const folder = opts.word.startsWith('/')
    ? opts.word.slice(0, at + 1)
    : join(opts.base, opts.word.slice(0, at + 1));

  try {
    // both sides in lower case: bash `nocaseglob` matches without regard to case, so this can only ask more often
    const glob = new Bun.Glob(opts.word.slice(at + 1).toLowerCase());

    return !readdirSync(folder).some((entry) => glob.match(entry.toLowerCase()));
    // eslint-disable-next-line venizia/no-silent-catch -- an unreadable folder is not a miss (see the doc comment): the probe answers false, and a guard speaks only its protocol
  } catch {
    return false;
  }
};

/** A word with a pattern in it: the shell expands `*`, `?` and `[...]` into the names that match. */
const GLOB_CHARACTER = /[*?[]/;

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
 * with the variable in its environment), else the project's own folder when Claude Code's session-start
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
    /** The local modules the config imports, relative to the root (`guard.configModules` of the manifest): protected like the config. */
    configModules?: string[];
    home?: string;
    env?: TEnvironment;
  }): IOutsideHit[] {
    const env = opts.env ?? process.env;
    const home = opts.home ?? env.HOME ?? '';
    const root =
      OutsidePaths.realOf({ path: resolve(opts.projectRoot) }) ?? resolve(opts.projectRoot);
    const store = OutsidePaths.packageStoreOf({ root });
    // A name is matched as a glob: a bracket or a star in a module's name stands for itself.
    const modules = opts.configModules ?? [];
    const extra = modules.map((file) =>
      file.replace(/[*?[\]{}]/g, (character) => `\\${character}`),
    );
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

        for (const target of ShellWrites.targetsOf({
          command,
          base: folder.base,
          tmp,
          configModules: modules,
        })) {
          // A word that names a `for` variable stands for each of its values in turn.
          for (const vars of loopCombinations({ word: target.word, loops: folder.loops })) {
            targets.push({
              ...target,
              pwd: folder.pwd,
              vars: { ...folder.vars, ...vars },
              isKnown: folder.isKnown,
              links: folder.links,
              hasUnknownLink: folder.hasUnknownLink,
              // The text of a word reads `'$S'` as a live `$S`; the shell takes the `$` as a character.
              hasLiteralDollar:
                target.word.includes('$') &&
                (command.literalDollars ?? []).some(
                  (literal) => literal.includes(target.word) || target.word.includes(literal),
                ),
            });
          }
        }
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
      if (target.hasUnreadBrace === true && target.isProtectedOnly !== true) {
        hits.push({
          path: target.word,
          message: `${target.message}: the word has a brace pattern this check cannot expand`,
          isAgentToolScratchpad: false,
          isUnread: true,
        });
      }

      // A link the line made under a name this check could not work out may be on any path that follows.
      if (
        target.hasUnknownLink === true &&
        target.isLinkRead !== true &&
        target.isNameInFolder !== true &&
        target.isIntoFolder !== true
      ) {
        hits.push({
          path: target.word,
          message: `${target.message}: the line made a symbolic link under a name this check cannot work out, so the path may go through it`,
          isAgentToolScratchpad: false,
          isUnread: true,
        });
        continue;
      }

      if (target.hasLiteralDollar === true) {
        hits.push({
          path: target.word,
          message: `${target.message}: the word has a quoted or escaped $, which this check does not follow`,
          isAgentToolScratchpad: false,
          isUnread: true,
        });
        continue;
      }

      // A redirect to `dir/[version].md` (a VitePress route file) names that file when the pattern matches nothing in `dir`:
      // the shell takes the word as written, and the written path is checked as it is. A match is written through, so it asks.
      const isLiteralBracket =
        target.isRedirect === true &&
        target.isKnown !== false &&
        BRACKET_NAME.test(target.word) &&
        matchesNothing({ word: target.word, base: target.base });
      const expanded = isLiteralBracket
        ? target.word
        : ShellPaths.expandPath({
            word: target.word,
            home,
            env: { ...env, ...target.vars },
            cwd: target.pwd,
          });

      // A pattern in a removal or an edit: the names it matches are not known, so it is judged by what it can reach.
      if (
        (target.isProtectedOnly === true || target.isEdit === true) &&
        target.isKnown !== false &&
        GLOB_CHARACTER.test(target.word) &&
        !/[$`~]/.test(target.word)
      ) {
        const pattern = isAbsolute(target.word) ? target.word : `${target.base}/${target.word}`;
        const cut = pattern.search(GLOB_CHARACTER);
        const folder = pattern.slice(0, pattern.lastIndexOf('/', cut) + 1) || '/';
        const real = OutsidePaths.realOf({ path: folder });
        const reaches =
          real !== undefined &&
          OutsidePaths.globReachesProtected({
            glob: `${real === '/' ? '' : real}/${pattern.slice(folder.length)}`,
            root,
            modules,
          });

        if (reaches) {
          hits.push({
            path: pattern,
            message: `${target.message}: the pattern can match one of the files the guards read their policy from`,
            isAgentToolScratchpad: false,
            isUnread: false,
            isProtected: true,
          });

          continue;
        }

        // A removal of names this check cannot work out is left to the owner; an edit is judged like any write.
        if (target.isProtectedOnly === true) {
          continue;
        }
      }

      if (expanded === undefined && target.isProtectedOnly === true) {
        // A removal or an edit in place of a word this check cannot work out: nothing says it is a guard file.
        continue;
      }

      if (expanded === undefined) {
        // Part of the word is unknown, but the folder in front of it may not be: that folder decides.
        const lands = ShellPaths.folderOfUnknown({
          word: target.word,
          home,
          env: { ...env, ...target.vars },
          cwd: target.pwd,
          base: target.base,
          isKnown: target.isKnown ?? true,
          assigned,
        });
        const folder = lands === undefined ? undefined : OutsidePaths.realOf({ path: lands });

        if (
          folder !== undefined &&
          !OutsidePaths.isInside({ path: folder, root }) &&
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
            isLink: target.isLinkSource === true,
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

      // A path at or through a link the line made is where the link points, which is not on disk yet to be followed. The name a
      // link command makes is its own, so it is the command's destination and not a path through an earlier link.
      // A name this check adds for a protected folder (`cp f dir` writes `dir/f`) is judged by what it is: the destination itself has said the rest.
      const through =
        target.isNameInFolder === true || target.isIntoFolder === true
          ? undefined
          : ShellPaths.passesThrough({
              path: expanded,
              base: target.base,
              links: target.links ?? [],
              isLastCounted: target.isLinkName !== true,
            });

      if (through !== undefined) {
        hits.push({
          path: target.word,
          message:
            through === 'dangling'
              ? `${target.message}: the path is, or goes through, a dangling link, which may lead where this line makes a link`
              : `${target.message}: the path is, or goes through, a link this line made, which this check does not follow`,
          isAgentToolScratchpad: false,
          isUnread: true,
        });

        continue;
      }

      // What a copy or a move reads is not written, and a link it reads has been looked at above.
      if (target.isLinkRead === true) {
        continue;
      }

      // After a `cd` this check could not work out, `base` is only the last folder it knew: a relative path cannot be placed.
      if (!isAbsolute(expanded) && target.isKnown === false) {
        hits.push({
          path: target.word,
          message: `${target.message}: it is a relative path after a \`cd\` this check cannot work out`,
          isAgentToolScratchpad: false,
          isUnread: true,
        });

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
      const path = OutsidePaths.realOf({ path: written });

      if (path === undefined) {
        hits.push({
          path: written,
          message: `${target.message}: the path goes through more links than the system follows`,
          isAgentToolScratchpad: false,
          isUnread: true,
        });

        continue;
      }

      // A write to a file the guards read their policy from switches a guard off: denied whatever the project sets.
      const mode: TProtectedMode =
        target.isIntoFolder === true
          ? 'folder'
          : target.isPut === true || target.isNameInFolder === true
            ? 'put'
            : target.isProtectedOnly === true
              ? 'removal'
              : 'file';

      if (
        OutsidePaths.isProtectedFile({ path, root, mode, store, extra }) ||
        OutsidePaths.isProtectedFile({ path: resolve(written), root, mode, store, extra })
      ) {
        hits.push({
          path,
          message: `${target.message}: it is one of the files the guards read their policy from`,
          isAgentToolScratchpad: false,
          isUnread: false,
          isProtected: true,
        });

        continue;
      }

      if (target.isProtectedOnly === true || target.isIntoFolder === true) {
        continue;
      }

      if (!OutsidePaths.isInside({ path, root }) && !matchesAny({ path, patterns })) {
        hits.push({
          path,
          message: target.message,
          isAgentToolScratchpad: matchesAny({
            path,
            patterns: HookConstants.AGENT_TOOL_SCRATCHPAD_PATTERNS,
          }),
          isUnread: false,
          isLink: target.isLinkSource === true,
        });
      }
    }

    // A loop makes one target of a word for each value it takes: a finding is told once.
    return hits.filter(
      (hit, index) =>
        hits.findIndex((other) => other.message === hit.message && other.path === hit.path) ===
        index,
    );
  }
}
