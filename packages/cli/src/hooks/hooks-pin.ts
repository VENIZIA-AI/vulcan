import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GuardDecisions } from './common/index.ts';
import type { IGitHit } from './common/index.ts';
import { ShellParser } from './shell.ts';

const MANIFEST = '.agents/vulcan.manifest.json';
/** The files whose lines that name the package decide which package the owner's command runs. */
const PACKAGE_FILES = ['package.json', 'bun.lock'];
const NAME = '@venizia/vulcan';
const RULE = 'V-S-05';
/** Git commands that rewrite objects or refs by hand: an agent has no need of them, and they are how a bundle's sums are forged. */
const PLUMBING = new Set(['replace', 'update-ref', 'commit-tree', 'symbolic-ref']);
/** Commands that stage: a commit on the same line commits what they staged. */
const STAGING = new Set(['add', 'rm', 'mv', 'update-index', 'apply']);
/** The options of these commands that take the next word, so it is not read as a ref. */
const VALUE_OPTIONS = new Set([
  '-m',
  '-F',
  '-C',
  '-c',
  '-S',
  '--message',
  '--file',
  '--author',
  '--date',
  '-X',
  '-s',
  '-b',
  '-B',
]);
/** The options that only carry on a git operation that has already begun: nothing new comes in. */
const CONTINUING = new Set(['--continue', '--abort', '--quit', '--skip']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The sums the hooks are checked against live in the manifest at `HEAD`, so they reach `HEAD` only through a commit, a merge or another way
 * of moving `HEAD`: one that changes the `hooks` block of the manifest, or the lines of `package.json` and `bun.lock` that name
 * `@venizia/vulcan`, asks (denied where every ask is held). Git's plumbing that forges a blob or a ref, and an alias set on the command
 * line, are denied: an agent has no need of them. This is a guard against drift and mistakes, not a sandbox against the same user.
 */
export class HooksPin {
  /** Git run with replacement objects ignored: `git replace` would otherwise put another blob under the name of the manifest. */
  private static run(opts: { cwd: string; args: string[] }): string | undefined {
    const result = spawnSync('git', ['--no-replace-objects', '-C', opts.cwd, ...opts.args], {
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' },
    });

    return result.status === 0 ? result.stdout : undefined;
  }

  /** `git show` names the index as `:./file` and any other ref as `ref:./file`. */
  private static spec(opts: { ref: string; file: string }): string {
    return opts.ref === ':' ? `:./${opts.file}` : `${opts.ref}:./${opts.file}`;
  }

  private static hooksOf(opts: { text: string | undefined }): string {
    try {
      const parsed: unknown = JSON.parse(opts.text ?? '');

      return isRecord(parsed) && parsed['hooks'] !== undefined
        ? JSON.stringify(parsed['hooks'])
        : '';
    } catch {
      return '';
    }
  }

  private static linesOf(opts: { text: string | undefined }): string {
    return (opts.text ?? '')
      .split('\n')
      .filter((line) => line.includes(NAME))
      .join('\n');
  }

  /** What the pin is at a git ref (`:` is the index): the hooks block and the package lines, as one string. */
  private static pinAt(opts: { cwd: string; ref: string }): string {
    const show = (file: string): string | undefined =>
      HooksPin.run({ cwd: opts.cwd, args: ['show', HooksPin.spec({ ref: opts.ref, file })] });

    return [
      HooksPin.hooksOf({ text: show(MANIFEST) }),
      ...PACKAGE_FILES.map((file) => HooksPin.linesOf({ text: show(file) })),
    ].join('\n--\n');
  }

  /** What the pin is in the working tree. */
  private static pinOfTree(opts: { cwd: string }): string {
    const read = (file: string): string | undefined => {
      try {
        return readFileSync(join(opts.cwd, file), 'utf8');
      } catch {
        return undefined;
      }
    };

    return [
      HooksPin.hooksOf({ text: read(MANIFEST) }),
      ...PACKAGE_FILES.map((file) => HooksPin.linesOf({ text: read(file) })),
    ].join('\n--\n');
  }

  /** Whether `ref` names a commit here. */
  private static resolves(opts: { cwd: string; ref: string }): boolean {
    return (
      HooksPin.run({
        cwd: opts.cwd,
        args: ['rev-parse', '--verify', '--quiet', `${opts.ref}^{commit}`],
      }) !== undefined
    );
  }

  /** The merge base of `HEAD` and a ref: what the ref's own change is measured from. */
  private static baseOf(opts: { cwd: string; ref: string }): string | undefined {
    const base = HooksPin.run({ cwd: opts.cwd, args: ['merge-base', 'HEAD', opts.ref] })?.trim();

    return base === undefined || base === '' ? undefined : base;
  }

  /** The aliases of the repository's configuration, by name. */
  private static aliases(opts: { cwd: string }): Map<string, string> {
    const found = new Map<string, string>();
    const listed =
      HooksPin.run({ cwd: opts.cwd, args: ['config', '--get-regexp', '^alias\\.'] }) ?? '';

    for (const line of listed.split('\n')) {
      const at = line.indexOf(' ');

      if (at > 0) {
        found.set(line.slice('alias.'.length, at), line.slice(at + 1));
      }
    }

    return found;
  }

  /** The words of a git command line that are not options, and the values of the options that take one. */
  private static positional(opts: { args: string[] }): string[] {
    const words: string[] = [];
    let isEnd = false;

    for (let index = 0; index < opts.args.length; index += 1) {
      const word = opts.args[index] ?? '';

      if (!isEnd && word === '--') {
        isEnd = true;
      } else if (!isEnd && word.startsWith('-')) {
        if (VALUE_OPTIONS.has(word)) {
          index += 1;
        }
      } else {
        words.push(word);
      }
    }

    return words;
  }

  private static ask(opts: { message: string }): IGitHit[] {
    return [{ rule: RULE, decision: GuardDecisions.ASK, message: opts.message }];
  }

  private static comes(opts: { what: string }): IGitHit[] {
    return HooksPin.ask({
      message: `git ${opts.what} changes the hooks block of the manifest or a line of package.json or bun.lock that names ${NAME}: the sums the hooks are checked against reach HEAD only through the owner`,
    });
  }

  private static cannot(opts: { what: string }): IGitHit[] {
    return HooksPin.ask({
      message: `git ${opts.what} moves HEAD to something this check cannot read before it runs, and it may carry other sums for the hooks: the owner decides`,
    });
  }

  /** A commit, from the index, and from the working tree when the line stages, names `-a`, or names a file. */
  private static judgeCommit(opts: {
    cwd: string;
    args: string[];
    words: string[];
    isStaged: boolean;
  }): IGitHit[] {
    const here = HooksPin.pinAt({ cwd: opts.cwd, ref: 'HEAD' });
    const isWorkingTree =
      opts.isStaged ||
      opts.args.some(
        (word) => /^-[a-zA-Z]*a[a-zA-Z]*$/.test(word) || word === '--all' || word === '--include',
      ) ||
      // A word that names a file of the project is a pathspec: `git commit <file>` commits the working tree version of it.
      opts.words.some((word) => existsSync(join(opts.cwd, word)));
    const isChanged =
      here !== HooksPin.pinAt({ cwd: opts.cwd, ref: ':' }) ||
      (isWorkingTree && here !== HooksPin.pinOfTree({ cwd: opts.cwd }));

    return isChanged ? HooksPin.comes({ what: 'commit' }) : [];
  }

  /** The commands that bring another commit's change in, measured where the change starts: the merge base, or the parent. */
  private static judgeIncoming(opts: { cwd: string; sub: string; words: string[] }): IGitHit[] {
    const { cwd, sub } = opts;

    if (sub === 'merge' || sub === 'pull' || sub === 'rebase') {
      const refs =
        sub === 'pull'
          ? ['FETCH_HEAD']
          : opts.words.length > 0
            ? opts.words.slice(0, 1)
            : sub === 'rebase'
              ? ['@{upstream}']
              : [];

      for (const ref of refs) {
        const base = HooksPin.resolves({ cwd, ref }) ? HooksPin.baseOf({ cwd, ref }) : undefined;

        if (base === undefined) {
          return HooksPin.cannot({ what: sub });
        }

        if (HooksPin.pinAt({ cwd, ref: base }) !== HooksPin.pinAt({ cwd, ref })) {
          return HooksPin.comes({ what: sub });
        }
      }

      return [];
    }

    for (const ref of opts.words) {
      if (
        !HooksPin.resolves({ cwd, ref }) ||
        ref.includes('..') ||
        !HooksPin.resolves({ cwd, ref: `${ref}^` })
      ) {
        return HooksPin.cannot({ what: sub });
      }

      if (HooksPin.pinAt({ cwd, ref: `${ref}^` }) !== HooksPin.pinAt({ cwd, ref })) {
        return HooksPin.comes({ what: sub });
      }
    }

    return [];
  }

  /**
   * What one git command does to the pin, or nothing: `sub` is the subcommand once aliases are resolved, `args` the words after it, and
   * `isStaged` says that the same line staged something before it.
   */
  private static judge(opts: {
    cwd: string;
    sub: string;
    args: string[];
    isStaged: boolean;
  }): IGitHit[] {
    const { cwd, sub, args } = opts;
    const words = HooksPin.positional({ args });

    if (sub === 'commit') {
      return HooksPin.judgeCommit({ cwd, args, words, isStaged: opts.isStaged });
    }

    if (sub === 'stash' && (words[0] === 'pop' || words[0] === 'apply')) {
      const ref = words.find((word) => /^stash@\{\d+\}$/.test(word)) ?? 'stash@{0}';

      return HooksPin.pinAt({ cwd, ref: 'HEAD' }) === HooksPin.pinAt({ cwd, ref })
        ? []
        : HooksPin.comes({ what: `stash ${words[0]}` });
    }

    if (args.some((word) => CONTINUING.has(word))) {
      return [];
    }

    if (['merge', 'pull', 'rebase', 'cherry-pick', 'revert'].includes(sub)) {
      return HooksPin.judgeIncoming({ cwd, sub, words });
    }

    // These put the tree of another commit under HEAD.
    if (sub === 'checkout' || sub === 'switch' || sub === 'reset') {
      const here = HooksPin.pinAt({ cwd, ref: 'HEAD' });
      const moved = words.filter((word) => HooksPin.resolves({ cwd, ref: word }));

      return moved.some((ref) => HooksPin.pinAt({ cwd, ref }) !== here)
        ? HooksPin.comes({ what: sub })
        : [];
    }

    // A mailbox of patches: what they change is not visible before they are applied.
    return sub === 'am' ? HooksPin.cannot({ what: sub }) : [];
  }

  /** What a command line does to the pin: plumbing and an alias set on the line are denied, and a git command that changes the sums asks. */
  static inspectCommand(opts: { command: string; cwd: string }): IGitHit[] {
    const parsed = ShellParser.parseChecked({ command: opts.command });
    let isStaged = false;

    for (const command of parsed.commands) {
      const program = ShellParser.programOf({ command });

      if (ShellParser.basenameOf({ word: program.name }) !== 'git') {
        continue;
      }

      let folder = opts.cwd;
      const rest: string[] = [];

      for (let index = 0; index < program.args.length; index += 1) {
        const word = program.args[index] ?? '';

        if (rest.length > 0) {
          rest.push(word);
        } else if (word === '-C') {
          folder = join(folder, program.args[index + 1] ?? '');
          index += 1;
        } else if (word === '-c') {
          const setting = program.args[index + 1] ?? '';

          if (/^alias\./i.test(setting)) {
            return [
              {
                rule: RULE,
                decision: GuardDecisions.DENY,
                message: `git -c ${setting.split('=')[0]} defines an alias on the command line, which can make a git command mean another`,
              },
            ];
          }

          index += 1;
        } else if (!word.startsWith('-')) {
          rest.push(word);
        }
      }

      const [first = '', ...after] = rest;
      let sub = first;
      let args = after;
      const expansion = HooksPin.aliases({ cwd: folder }).get(first);

      if (expansion !== undefined) {
        if (expansion.startsWith('!')) {
          return HooksPin.ask({
            message: `git ${first} is a shell alias (${expansion.slice(0, 60)}): what it runs cannot be read`,
          });
        }

        const [head = '', ...tail] = expansion.split(/\s+/);

        sub = head;
        args = [...tail, ...after];
      }

      if (PLUMBING.has(sub)) {
        return [
          {
            rule: RULE,
            decision: GuardDecisions.DENY,
            message: `git ${sub} rewrites an object or a ref by hand, which is how the sums the hooks are checked against are forged: the owner does it, if it is ever needed`,
          },
        ];
      }

      const hits = HooksPin.judge({ cwd: folder, sub, args, isStaged });

      if (hits.length > 0) {
        return hits;
      }

      if (STAGING.has(sub)) {
        isStaged = true;
      }
    }

    return [];
  }
}
