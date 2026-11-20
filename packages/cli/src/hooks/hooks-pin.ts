import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GuardDecisions } from './common/index.ts';
import type { IGitHit } from './common/index.ts';
import { ShellParser } from './shell.ts';

const MANIFEST = '.agents/vulcan.manifest.json';
/** The files whose `@venizia/vulcan` lines decide which package the owner's command runs. */
const PACKAGE_FILES = ['package.json', 'bun.lock'];
const NAME = '@venizia/vulcan';
const RULE = 'V-S-05';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The sums the hooks are checked against live in the manifest at `HEAD`, so they reach `HEAD` only through a commit: one that changes the
 * `hooks` block of the manifest, or the lines of `package.json` and `bun.lock` that name `@venizia/vulcan`, asks (denied where every ask is).
 */
export class HooksPin {
  /** `git show` names the index as `:./file` and any other ref as `ref:./file`. */
  private static spec(opts: { ref: string; file: string }): string {
    return opts.ref === ':' ? `:./${opts.file}` : `${opts.ref}:./${opts.file}`;
  }

  private static run(opts: { cwd: string; args: string[] }): string | undefined {
    const result = spawnSync('git', ['-C', opts.cwd, ...opts.args], {
      encoding: 'utf8',
      timeout: 10_000,
    });

    return result.status === 0 ? result.stdout : undefined;
  }

  /** The `hooks` block of the manifest at a git ref (`HEAD`, `:` for the index, `stash@{0}`), or `undefined`. */
  private static hooksAt(opts: { cwd: string; ref: string }): string | undefined {
    return HooksPin.hooksOf({
      text: HooksPin.run({
        cwd: opts.cwd,
        args: ['show', HooksPin.spec({ ref: opts.ref, file: MANIFEST })],
      }),
    });
  }

  private static hooksOf(opts: { text: string | undefined }): string | undefined {
    try {
      const parsed: unknown = JSON.parse(opts.text ?? '');

      return isRecord(parsed) && parsed['hooks'] !== undefined
        ? JSON.stringify(parsed['hooks'])
        : undefined;
    } catch {
      return undefined;
    }
  }

  /** The lines of a file that name the package, at a ref or (with `ref` undefined) in the working tree. */
  private static packageLines(opts: {
    cwd: string;
    ref: string | undefined;
    file: string;
  }): string {
    let text: string | undefined;

    try {
      text =
        opts.ref === undefined
          ? readFileSync(join(opts.cwd, opts.file), 'utf8')
          : HooksPin.run({
              cwd: opts.cwd,
              args: ['show', HooksPin.spec({ ref: opts.ref, file: opts.file })],
            });
    } catch {
      text = undefined;
    }

    return (text ?? '')
      .split('\n')
      .filter((line) => line.includes(NAME))
      .join('\n');
  }

  /** Whether the manifest's `hooks` block or a package line differs between `HEAD` and `ref` (the working tree when `ref` is undefined). */
  private static differs(opts: { cwd: string; ref: string | undefined }): boolean {
    const before = HooksPin.hooksAt({ cwd: opts.cwd, ref: 'HEAD' });
    let after: string | undefined;

    try {
      after =
        opts.ref === undefined
          ? HooksPin.hooksOf({ text: readFileSync(join(opts.cwd, MANIFEST), 'utf8') })
          : HooksPin.hooksAt({ cwd: opts.cwd, ref: opts.ref });
    } catch {
      after = undefined;
    }

    return (
      before !== after ||
      PACKAGE_FILES.some(
        (file) =>
          HooksPin.packageLines({ cwd: opts.cwd, ref: 'HEAD', file }) !==
          HooksPin.packageLines({ cwd: opts.cwd, ref: opts.ref, file }),
      )
    );
  }

  /** What a git command line does to the pin: a commit or an amend that changes it, and a stash pop or apply that brings a change in. */
  static inspectCommand(opts: { command: string; cwd: string }): IGitHit[] {
    const parsed = ShellParser.parseChecked({ command: opts.command });

    for (const command of parsed.commands) {
      const program = ShellParser.programOf({ command });

      if (ShellParser.basenameOf({ word: program.name }) !== 'git') {
        continue;
      }

      let folder = opts.cwd;
      const words: string[] = [];

      for (let index = 0; index < program.args.length; index += 1) {
        const word = program.args[index] ?? '';

        if (word === '-C') {
          folder = join(folder, program.args[index + 1] ?? '');
          index += 1;
        } else if (word === '-c') {
          index += 1;
        } else if (!word.startsWith('-') || words.length > 0) {
          words.push(word);
        }
      }

      const [sub, second] = words;
      const isWorkingTree =
        program.args.some(
          (word) => /^-[a-zA-Z]*a[a-zA-Z]*$/.test(word) || word === '--all' || word === '--include',
        ) ||
        // A word that names a file of the project is a pathspec: `git commit <file>` commits the working tree version of it.
        words.slice(1).some((word) => existsSync(join(folder, word)));
      const stash = words.find((word) => /^stash@\{\d+\}$/.test(word)) ?? 'stash@{0}';
      const changes =
        sub === 'commit'
          ? HooksPin.differs({ cwd: folder, ref: ':' }) ||
            (isWorkingTree && HooksPin.differs({ cwd: folder, ref: undefined }))
          : sub === 'stash' && (second === 'pop' || second === 'apply')
            ? HooksPin.differs({ cwd: folder, ref: stash })
            : false;

      if (changes) {
        return [
          {
            rule: RULE,
            decision: GuardDecisions.ASK,
            message: `git ${sub}${sub === 'stash' ? ` ${second}` : ''} changes the hooks block of the manifest or a line of package.json or bun.lock that names ${NAME}: the sums the hooks are checked against reach HEAD only through the owner`,
          },
        ];
      }
    }

    return [];
  }
}
