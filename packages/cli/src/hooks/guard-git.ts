import { spawnSync } from 'node:child_process';
import { basenameOf, parseShell, programOf } from './shell.ts';
import type { ISimpleCommand } from './shell.ts';
import { GuardDecisions, HookConstants } from './common/index.ts';
import type { IGitHit, IGitRunner } from './common/index.ts';

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
}): IGitHit[] => {
  const flags = opts.rest.filter((word) => word.startsWith('-') && word !== '-');
  const positional = opts.rest.filter((word) => !word.startsWith('-'));
  const [, ...refspecs] = positional;
  const forced =
    flags.some((flag) => flag === '-f' || flag.startsWith('--force')) ||
    refspecs.some((refspec) => refspec.startsWith('+'));
  const deleting =
    flags.includes('-d') || flags.includes('--delete') || refspecs.some((r) => r.startsWith(':'));
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

  if (forced && !hits.some((hit) => hit.message.startsWith('force-pushing'))) {
    hits.push({
      decision: GuardDecisions.ASK,
      rule: 'V-W-06',
      message: 'a force-push rewrites history others may have pulled',
    });
  }

  return hits;
};

const inspectBranch = (opts: {
  rest: string[];
  cwd: string | undefined;
  run: IGitRunner;
}): IGitHit[] => {
  const flags = opts.rest.filter((word) => word.startsWith('-'));
  const deleting = flags.some(
    (flag) => flag === '--delete' || (/^-[a-zA-Z]+$/.test(flag) && /[dD]/.test(flag)),
  );

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
    args: ['branch', '--merged', '--format=%(refname:short)'],
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

const inspectOne = (opts: {
  command: ISimpleCommand;
  cwd: string | undefined;
  run: IGitRunner;
}): IGitHit[] => {
  const program = programOf({ command: opts.command });
  const name = basenameOf({ word: program.name });

  if (name === 'gh') {
    return inspectGhMerge({ args: program.args, cwd: opts.cwd, run: opts.run });
  }

  if (name !== 'git') {
    return [];
  }

  const call = gitCall({ args: program.args });
  const cwd = call.dir ?? opts.cwd;

  if (call.sub === 'push') {
    return inspectPush({ rest: call.rest, cwd, run: opts.run });
  }

  if (call.sub === 'branch') {
    return inspectBranch({ rest: call.rest, cwd, run: opts.run });
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
}): IGitHit[] =>
  parseShell({ command: opts.command }).flatMap((command) =>
    inspectOne({ command, cwd: opts.cwd, run: opts.run ?? runQuery }),
  );
