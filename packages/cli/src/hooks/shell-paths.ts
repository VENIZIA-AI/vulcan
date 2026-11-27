import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { TEnvironment, TLinkPassage } from './common/index.ts';
import { ShellConstants } from './common/index.ts';

/** The links one path may pass through before it is taken for a loop, as the system counts them. */
const MAX_LINK_HOPS = 40;

/** Where a path of a shell line leads: `~` and variables expanded, links followed. */
export class ShellPaths {
  /** The home folder of a user, read from the password file; `undefined` for a name it does not list. */
  private static homeOf(opts: { name: string }): string | undefined {
    try {
      for (const line of readFileSync('/etc/passwd', 'utf8').split('\n')) {
        const fields = line.split(':');

        if (fields[0] === opts.name) {
          return fields[5];
        }
      }
      // eslint-disable-next-line venizia/no-silent-catch -- no readable password file means the user is not known; a guard speaks only its protocol
    } catch {
      return undefined;
    }

    return undefined;
  }

  /**
   * `~` and `$NAME` / `${NAME}` expanded; `undefined` when a variable is unset or the word is not a plain path.
   * `$PWD` is the folder the command runs in (`cwd`), not the `PWD` of this hook's own process.
   */
  static expandPath(opts: {
    word: string;
    home: string;
    env: TEnvironment;
    cwd?: string;
  }): string | undefined {
    if (opts.word === '' || /[`*?[]/.test(opts.word) || opts.word.includes('$(')) {
      return undefined;
    }

    let unresolved = false;
    // `~` is the home folder, `~+` the working folder, `~name` the home of that user. A name the password file does
    // not list, and `~-` (the shell's previous folder, not known here), stay as written: a plain path, as bash
    // leaves an unknown `~name`.
    const tilde = opts.word.startsWith('~') ? /^~([^/]*)/.exec(opts.word) : null;
    const user = tilde?.[1] ?? '';
    let home: string | undefined = user === '' ? opts.home : undefined;

    if (user === '+') {
      home = opts.cwd;
    } else if (user !== '' && user !== '-') {
      home = ShellPaths.homeOf({ name: user });
    }

    const withHome =
      tilde === null || home === undefined
        ? opts.word
        : `${home}${opts.word.slice(tilde[0].length)}`;
    const expanded = withHome.replace(
      ShellConstants.VARIABLE,
      (_, bare: string | undefined, braced: string | undefined) => {
        const name = bare ?? braced ?? '';
        const value = name === 'PWD' && opts.cwd !== undefined ? opts.cwd : opts.env[name];

        if (value === undefined || value === '') {
          unresolved = true;
        }

        return value ?? '';
      },
    );

    // A `$` left over is an expansion with an operator (`${S/a/..}`, `${S#x}`, `${!S}`) or a special parameter (`$$`, `$?`):
    // the value is not the plain text of a variable, so the word is not worked out.
    return unresolved || expanded.includes('$') ? undefined : expanded;
  }

  /** The name as the system sees it: the real path of the part that exists, then the rest as written. */
  static physicalOf(opts: { path: string }): string {
    const rest: string[] = [];
    let existing = opts.path;

    while (existing !== dirname(existing)) {
      try {
        return join(realpathSync(existing), ...rest.reverse());
      } catch {
        rest.push(basename(existing));
        existing = dirname(existing);
      }
    }

    return opts.path;
  }

  /**
   * Whether the path, read name by name from `base`, passes through one of `links` (absolute names): a link is followed where it
   * points, so what comes after it, a `..` included, is not where the text says. The last name counts only when `isLastCounted` (a
   * `cd` into the link itself), not for a file written at the link's own name.
   */
  static passesThrough(opts: {
    path: string;
    base: string;
    links: string[];
    isLastCounted: boolean;
  }): TLinkPassage | undefined {
    interface IStep {
      part: string;
      /** A link of the line at this name counts. */
      counts: boolean;
      /** The last name of the path being read. */
      isEnd: boolean;
    }

    const parts = opts.path.split('/').filter((part) => part !== '' && part !== '.');
    const pending: IStep[] = parts
      .map((part, index) => ({
        part,
        counts: index < parts.length - 1 || opts.isLastCounted,
        isEnd: index === parts.length - 1,
      }))
      .reverse();
    let current = isAbsolute(opts.path) ? '/' : opts.base;
    let hops = 0;

    for (;;) {
      const step = pending.pop();

      if (step === undefined) {
        return undefined;
      }

      if (step.part === '..') {
        if (opts.links.includes(current)) {
          return 'made';
        }

        current = dirname(current);
        continue;
      }

      current = join(current, step.part);

      if (step.counts && opts.links.includes(current)) {
        return 'made';
      }

      // A link already on disk is followed where it points: it may lead to a link this line makes, and a link that points at
      // nothing yet, in the middle of a path, is where this line may make the folder it needs.
      let target: string | undefined;

      try {
        target = lstatSync(current).isSymbolicLink() ? readlinkSync(current) : undefined;
        // eslint-disable-next-line venizia/no-silent-catch -- a component that cannot be read is no link; a guard speaks only its protocol
      } catch {
        target = undefined;
      }

      if (target === undefined) {
        continue;
      }

      hops += 1;

      // A name the command makes itself is not a path through a link of the line, even when it dangles.
      if (hops > MAX_LINK_HOPS) {
        return 'made';
      }

      if ((!step.isEnd || step.counts) && !existsSync(current)) {
        return 'dangling';
      }

      current = isAbsolute(target) ? '/' : dirname(current);

      const followed = target.split('/').filter((part) => part !== '' && part !== '.');

      pending.push(
        ...followed
          .map((part, index) => ({
            part,
            counts: true,
            isEnd: step.isEnd && index === followed.length - 1,
          }))
          .reverse(),
      );
    }
  }

  /**
   * The folder a word lands in when part of it cannot be worked out (`/etc/$X`, `~/.ssh/key$N`, `/etc/*.conf`): the
   * longest run of folders in front of the unknown part that `expandPath` can work out; a name with no folder in
   * front of it is in `base`. `undefined` when the first folder is the unknown part (`$D/x`; `$f` when the line
   * assigned `f`, whose value may be a path of its own), the word is `~` followed by an unknown name, or it is taken
   * from a `base` the guard lost (`isKnown` false).
   */
  static folderOfUnknown(opts: {
    word: string;
    home: string;
    env: TEnvironment;
    cwd?: string;
    base: string;
    isKnown: boolean;
    /** The names the line assigned. */
    assigned: ReadonlySet<string>;
  }): string | undefined {
    const parts = opts.word.split('/');

    for (let count = parts.length - 1; count >= 1; count -= 1) {
      const folder = ShellPaths.expandPath({
        word: `${parts.slice(0, count).join('/')}/`,
        home: opts.home,
        env: opts.env,
        cwd: opts.cwd,
      });

      if (folder !== undefined) {
        return isAbsolute(folder) ? folder : opts.isKnown ? `${opts.base}/${folder}` : undefined;
      }
    }

    const name = /^\$\{?(\w+)/.exec(opts.word)?.[1];
    const isUnknown =
      !opts.isKnown ||
      parts.length > 1 ||
      opts.word.startsWith('~') ||
      (name !== undefined && opts.assigned.has(name));

    return isUnknown ? undefined : opts.base;
  }
}
