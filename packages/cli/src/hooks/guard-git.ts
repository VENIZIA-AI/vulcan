import { spawnSync } from 'node:child_process';
import { basenameOf, parseShellChecked, programOf } from './shell.ts';
import type { ISimpleCommand } from './shell.ts';
import { GuardDecisions, HookConstants } from './common/index.ts';
import type { IGitHit, IGitRunner } from './common/index.ts';
import { matchesBranch } from './project-guards.ts';

/** `git` and `gh` read-only queries the guard makes; `undefined` when the tool is missing, slow or fails. */
export const runQuery: IGitRunner = (opts) => {
  const result = spawnSync(opts.program, opts.args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    timeout: HookConstants.QUERY_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });

  return result.status === 0 ? result.stdout.trim() : undefined;
};

/** Options of `git` before its subcommand, and how many words each takes. */
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);

/** The subcommand of a `git` line and the words after it, past `-C <dir>`, `-c k=v` and the like. */
const gitCall = (opts: { args: string[] }): { sub: string; rest: string[]; dir?: string } => {
  let index = 0;
  let dir: string | undefined;

  while (index < opts.args.length) {
    const word = opts.args[index];

    if (word === '-C') {
      dir = opts.args[index + 1];
      index += 2;
    } else if (GIT_OPTIONS_WITH_VALUE.has(word)) {
      index += 2;
    } else if (word.startsWith('-')) {
      index += 1;
    } else {
      return { sub: word, rest: opts.args.slice(index + 1), dir };
    }
  }

  return { sub: '', rest: [], dir };
};

const isProtected = (opts: { name: string }): boolean =>
  HookConstants.PROTECTED_BRANCHES.has(opts.name.replace(/^\+/, '').replace(/^refs\/heads\//, ''));

/** The branch a push refspec writes to: `dst` of `src:dst`, else the name itself. */
const pushTargetOf = (opts: { refspec: string; current: () => string | undefined }): string => {
  const bare = opts.refspec.replace(/^\+/, '');
  const target = bare.includes(':') ? bare.slice(bare.lastIndexOf(':') + 1) : bare;

  return target === 'HEAD' || target === '' ? (opts.current() ?? '') : target;
};

const inspectPush = (opts: {
  rest: string[];
  cwd: string | undefined;
  run: IGitRunner;
  askPush: string[];
}): IGitHit[] => {
  const flags = opts.rest.filter((word) => word.startsWith('-') && word !== '-');
  const positional = opts.rest.filter((word) => !word.startsWith('-'));
  const [, ...refspecs] = positional;
  const forced =
    flags.some((flag) => /^-[a-zA-Z]*f[a-zA-Z]*$/.test(flag) || flag.startsWith('--force')) ||
    refspecs.some((refspec) => refspec.startsWith('+'));
  const deleting =
    flags.some((flag) => /^-[a-zA-Z]*d[a-zA-Z]*$/.test(flag) || flag === '--delete') ||
    refspecs.some((r) => r.startsWith(':'));
  const current = (): string | undefined =>
    opts.run({
      program: 'git',
      args: ['rev-parse', '--abbrev-ref', 'HEAD'],
      cwd: opts.cwd,
    });
  const targets = (refspecs.length > 0 ? refspecs : [':current'])
    .map((refspec) => (refspec === ':current' ? (current() ?? '') : refspec))
    .map((refspec) =>
      deleting && !refspec.includes(':') ? refspec : pushTargetOf({ refspec, current }),
    )
    .filter((name) => name !== '');
  const hits: IGitHit[] = [];

  for (const name of targets.filter((target) => isProtected({ name: target }))) {
    if (deleting) {
      hits.push({
        decision: GuardDecisions.DENY,
        rule: 'V-W-06',
        message: `deleting the remote branch '${name}'`,
      });
    } else if (forced) {
      hits.push({
        decision: GuardDecisions.DENY,
        rule: 'V-W-06',
        message: `force-pushing to '${name}'`,
      });
    }
  }

  // A target the project lists asks even for a plain push; a hit already made says the push needs a human.
  if (hits.length === 0 && !deleting) {
    for (const name of targets) {
      const branch = name.replace(/^\+/, '').replace(/^refs\/heads\//, '');

      if (matchesBranch({ name: branch, patterns: opts.askPush })) {
        hits.push({
          decision: GuardDecisions.ASK,
          rule: 'V-W-06',
          message: `pushing to '${branch}', a target this project lists in guard.git.askPush`,
        });
      }
    }
  }

  if (flags.includes('--mirror')) {
    hits.push({
      decision: GuardDecisions.ASK,
      rule: 'V-W-06',
      message: 'git push --mirror overwrites and deletes remote branches to match this clone',
    });
  }

  if (forced && !hits.some((hit) => hit.message.startsWith('force-pushing'))) {
    hits.push({
      decision: GuardDecisions.ASK,
      rule: 'V-W-06',
      message: 'a force-push rewrites history others may have pulled',
    });
  }

  return hits;
};

/**
 * `git add -A`, `--all`, `.`, `-u` and `git commit -a` stage every change, a formatter's or a generator's included. Past
 * `HookConstants.BLANKET_STAGE_PATHS` changed paths the guard asks, so the files are named. A stage of named paths, `-p` and a
 * status that cannot be read pass: the guard asks, it does not deny, and it is not a sandbox.
 */
const inspectStage = (opts: {
  sub: string;
  rest: string[];
  cwd: string | undefined;
  run: IGitRunner;
}): IGitHit[] => {
  const flags = opts.rest.filter((word) => word.startsWith('-') && word !== '--');
  const paths = opts.rest.filter((word) => !word.startsWith('-'));
  const everything =
    opts.sub === 'add' &&
    (flags.some((flag) => flag === '--all' || /^-[a-zA-Z]*A[a-zA-Z]*$/.test(flag)) ||
      paths.includes('.')) &&
    paths.every((path) => path === '.');
  const tracked =
    (opts.sub === 'add' && flags.some((flag) => flag === '-u' || flag === '--update')) ||
    (opts.sub === 'commit' &&
      flags.some((flag) => flag === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(flag)));

  if (!everything && !tracked) {
    return [];
  }

  // One line per file: the default status prints a new folder as one line, which would undercount what `git add -A` takes.
  const status = opts.run({
    program: 'git',
    args: ['status', '--porcelain', '--untracked-files=all'],
    cwd: opts.cwd,
  });

  if (status === undefined) {
    return [];
  }

  const lines = status.split('\n').filter((line) => line.length > 0);
  const count = (everything ? lines : lines.filter((line) => !line.startsWith('??'))).length;

  return count > HookConstants.BLANKET_STAGE_PATHS
    ? [
        {
          decision: GuardDecisions.ASK,
          rule: 'V-W-06',
          message: `this stages ${count} changed paths at once (more than ${HookConstants.BLANKET_STAGE_PATHS}), a formatter's or a generator's included; name the files you mean`,
        },
      ]
    : [];
};

const inspectBranch = (opts: {
  rest: string[];
  cwd: string | undefined;
  run: IGitRunner;
}): IGitHit[] => {
  const flags = opts.rest.filter((word) => word.startsWith('-') && word !== '--');
  const renaming = flags.some(
    (flag) => flag === '--move' || (/^-[a-zA-Z]+$/.test(flag) && /[mM]/.test(flag)),
  );
  const deleting = flags.some(
    (flag) => flag === '--delete' || (/^-[a-zA-Z]+$/.test(flag) && /[dD]/.test(flag)),
  );

  if (renaming) {
    const [from] = opts.rest.filter((word) => !word.startsWith('-'));

    return from !== undefined && isProtected({ name: from })
      ? [
          {
            decision: GuardDecisions.DENY,
            rule: 'V-W-06',
            message: `renaming the branch '${from}'`,
          },
        ]
      : [];
  }

  if (!deleting) {
    return [];
  }

  const names = opts.rest.filter((word) => !word.startsWith('-'));
  const hits: IGitHit[] = names
    .filter((name) => isProtected({ name }))
    .map((name) => ({
      decision: GuardDecisions.DENY,
      rule: 'V-W-06',
      message: `deleting the branch '${name}'`,
    }));
  const forced = flags.some(
    (flag) => /^-[a-zA-Z]*D/.test(flag) || flag === '-f' || flag === '--force',
  );
  const merged = opts.run({
    program: 'git',
    args: ['branch', '--format=%(refname:short)', '--merged'],
    cwd: opts.cwd,
  });

  if (forced && merged !== undefined) {
    const mergedNames = new Set(merged.split('\n').map((line) => line.trim()));

    for (const name of names.filter((item) => !isProtected({ name: item }))) {
      if (!mergedNames.has(name)) {
        hits.push({
          decision: GuardDecisions.ASK,
          rule: 'V-W-06',
          message: `'${name}' is not merged into the current branch; force-deleting it loses its commits`,
        });
      }
    }
  }

  return hits;
};

/** `gh pr merge [<pr>] --delete-branch`: the PR's head branch decides, and `gh` is asked for it. */
const inspectGhMerge = (opts: {
  args: string[];
  cwd: string | undefined;
  run: IGitRunner;
}): IGitHit[] => {
  const [group, action, ...rest] = opts.args;

  if (group !== 'pr' || action !== 'merge') {
    return [];
  }

  const deletes = rest.some((word) => word === '--delete-branch' || /^-[a-zA-Z]*d/.test(word));

  if (!deletes) {
    return [];
  }

  const [target] = rest.filter((word) => !word.startsWith('-'));
  const head = opts.run({
    program: 'gh',
    args: [
      'pr',
      'view',
      ...(target === undefined ? [] : [target]),
      '--json',
      'headRefName',
      '-q',
      '.headRefName',
    ],
    cwd: opts.cwd,
  });

  return head !== undefined && isProtected({ name: head })
    ? [
        {
          decision: GuardDecisions.DENY,
          rule: 'V-W-06',
          message: `'gh pr merge --delete-branch' would delete '${head}', the head branch of this pull request`,
        },
      ]
    : [];
};

/**
 * `gh pr create` with no base: the pull request would target the repository's default branch, which may not be
 * the branch the project's changes go to (a project whose default is `main` takes its features on `develop`).
 * `--help` only reads.
 */
const inspectGhCreate = (opts: { args: string[] }): IGitHit[] => {
  const [group, action, ...rest] = opts.args;

  if (group !== 'pr' || action !== 'create') {
    return [];
  }

  const namesBase = rest.some(
    (word) => word === '--base' || word.startsWith('--base=') || /^-B/.test(word),
  );

  return namesBase || rest.includes('--help') || rest.includes('-h')
    ? []
    : [
        {
          decision: GuardDecisions.ASK,
          rule: 'V-W-06',
          message:
            "'gh pr create' names no --base, so the pull request targets the default branch; pass --base <branch> as the project's rule says",
        },
      ];
};

const inspectOne = (opts: {
  command: ISimpleCommand;
  cwd: string | undefined;
  run: IGitRunner;
  askPush: string[];
}): IGitHit[] => {
  const program = programOf({ command: opts.command });
  const name = basenameOf({ word: program.name });

  if (name === 'gh') {
    return [
      ...inspectGhMerge({ args: program.args, cwd: opts.cwd, run: opts.run }),
      ...inspectGhCreate({ args: program.args }),
    ];
  }

  if (name !== 'git') {
    return [];
  }

  const call = gitCall({ args: program.args });
  const cwd = call.dir ?? opts.cwd;

  if (call.sub === 'push') {
    return inspectPush({ rest: call.rest, cwd, run: opts.run, askPush: opts.askPush });
  }

  if (call.sub === 'branch') {
    return inspectBranch({ rest: call.rest, cwd, run: opts.run });
  }

  if (call.sub === 'add' || call.sub === 'commit') {
    return inspectStage({ sub: call.sub, rest: call.rest, cwd, run: opts.run });
  }

  if (call.sub === 'update-ref' && call.rest.some((word) => word === '-d' || word === '--delete')) {
    const refs = call.rest.filter((word) => !word.startsWith('-'));

    return refs
      .filter((ref) => isProtected({ name: ref }))
      .map((ref) => ({
        decision: GuardDecisions.DENY,
        rule: 'V-W-06',
        message: `deleting the ref '${ref}'`,
      }));
  }

  if (call.sub === 'reset' && call.rest.includes('--hard')) {
    return [
      {
        decision: GuardDecisions.ASK,
        rule: 'V-W-04',
        message: 'git reset --hard discards every uncommitted change',
      },
    ];
  }

  return [];
};

/** Every reason `command` is a git or gh action that loses history or a protected branch. */
export const inspectGit = (opts: {
  command: string;
  cwd: string | undefined;
  run?: IGitRunner;
  /** Branches (names, `*` allowed) a plain `git push` asks about: `guard.git.askPush`. */
  askPush?: string[];
}): IGitHit[] => {
  const parsed = parseShellChecked({ command: opts.command });
  const run = opts.run ?? runQuery;
  let queries = 0;
  let isCapped = false;

  // Every query is a process and can take seconds: a line may make a few, and asks past them.
  const limited: IGitRunner = (call) => {
    queries += 1;

    if (queries > HookConstants.MAX_QUERIES) {
      isCapped = true;

      return undefined;
    }

    return run(call);
  };
  const hits = parsed.commands.flatMap((command) =>
    inspectOne({ command, cwd: opts.cwd, run: limited, askPush: opts.askPush ?? [] }),
  );

  // Part of the line was not read: never an allow.
  if (parsed.isOverBudget) {
    hits.push({
      decision: GuardDecisions.ASK,
      rule: 'V-W-06',
      message:
        'this command line is larger, or nests deeper, than the guard reads, so it could not be checked',
    });
  }

  if (isCapped) {
    hits.push({
      decision: GuardDecisions.ASK,
      rule: 'V-W-06',
      message:
        'this command line needs more git or gh queries than the guard runs, so part of it could not be checked',
    });
  }

  return hits;
};
