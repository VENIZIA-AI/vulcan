import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import {
  commandTextsOf,
  inspectCommand,
  inspectGit,
  matchesBranch,
  readGuardPolicy,
} from '../../hooks/index.ts';
import type { IGitRunner, IProjectCommandCheck } from '../../hooks/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const WRITES_HOOK = join(import.meta.dir, '..', '..', '..', 'base', 'hooks', 'guard-writes.ts');
const GIT_HOOK = join(import.meta.dir, '..', '..', '..', 'base', 'hooks', 'guard-git.ts');

// BANA's own commands, which no fixed list could know.
const MIGRATE: IProjectCommandCheck = {
  rule: 'V-W-02',
  what: 'running a migration',
  pattern: /\bbun run migrate:/,
};
const DEPLOY: IProjectCommandCheck = {
  rule: 'V-W-03',
  what: 'deploying',
  pattern: /\bmake deploy-/,
};
const PROJECT = [MIGRATE, DEPLOY];

const hitsOf = (opts: { command: string; extra?: IProjectCommandCheck[] }): string[] =>
  inspectCommand({ command: opts.command, cwd: '/p', extra: opts.extra }).map(
    (hit) => `${hit.rule}: ${hit.message}`,
  );

describe("guard-writes asks on the project's own commands", () => {
  test("BANA's migrate and deploy commands: nothing without the patterns, a V-W-02 and a V-W-03 ask with them", () => {
    expect(hitsOf({ command: 'bun run migrate:up' })).toEqual([]);
    expect(hitsOf({ command: 'make deploy-develop-x' })).toEqual([]);

    expect(hitsOf({ command: 'bun run migrate:up', extra: PROJECT })).toEqual([
      expect.stringContaining('V-W-02: running a migration'),
    ]);
    expect(hitsOf({ command: 'make deploy-develop-x', extra: PROJECT })).toEqual([
      expect.stringContaining('V-W-03: deploying'),
    ]);
  });

  test("the message says the pattern is the project's", () => {
    expect(hitsOf({ command: 'make deploy-develop-x', extra: PROJECT })[0]).toContain(
      "this project's pattern",
    );
  });

  test.each([
    'cd services/api && make deploy-develop-x',
    'echo start; make deploy-develop-x',
    'make test || make deploy-develop-x',
    '(cd services/api; make deploy-develop-x)',
    '{ make deploy-develop-x; }',
    'if true; then make deploy-develop-x; fi',
    'bash -c "make deploy-develop-x"',
    'FOO=1 make deploy-develop-x',
    'true | make deploy-develop-x',
    'echo $(make deploy-develop-x)',
    'sudo make deploy-develop-x',
  ])('is found inside a compound command: %s', (command) => {
    expect(hitsOf({ command, extra: PROJECT }).length).toBeGreaterThan(0);
  });

  test.each([
    'make test',
    'bun run build',
    'bun run migrate',
    'make deployment-notes',
    'echo "make deploy-develop-x"',
    "rg 'make deploy-' docs",
    'git commit -m "make deploy-develop-x"',
    'cat deploy-notes.md',
    'grep -rn "bun run migrate:" scripts',
  ])('stays quiet for %s: other commands, and text that is data', (command) => {
    expect(hitsOf({ command, extra: PROJECT })).toEqual([]);
  });

  test('a pattern with ignoreCase matches the other spelling', () => {
    const extra: IProjectCommandCheck[] = [{ ...DEPLOY, pattern: /\bmake deploy-/i }];

    expect(hitsOf({ command: 'MAKE Deploy-x', extra }).length).toBe(1);
    expect(hitsOf({ command: 'MAKE Deploy-x', extra: [DEPLOY] })).toEqual([]);
  });

  test("the base patterns still apply beside the project's", () => {
    expect(hitsOf({ command: 'kubectl apply -f x.yaml', extra: PROJECT }).length).toBe(1);
  });
});

const runner =
  (opts: { current?: string }): IGitRunner =>
  (call) =>
    [call.program, ...call.args].join(' ').includes('rev-parse') ? opts.current : undefined;

const gitHits = (opts: { command: string; askPush?: string[]; current?: string }) =>
  inspectGit({
    command: opts.command,
    cwd: '/p',
    run: runner({ current: opts.current ?? 'topic' }),
    askPush: opts.askPush,
  });

// A project can list the commands that write a GitHub setting or secret. The arguments of `gh pr` and `gh issue` are messages
// (data, so a body that quotes a command is quiet); the arguments of `gh api`, `gh secret` and `gh variable` are the request,
// so a project pattern sees them.
describe("the project's patterns see the request of gh api, gh secret and gh variable, and not a message", () => {
  const GH: IProjectCommandCheck[] = [
    {
      rule: 'V-W-03',
      what: 'writing a GitHub secret',
      pattern: /\bgh\s+(?:secret|variable)\s+(?:set|delete|remove)\b/,
    },
    {
      rule: 'V-W-03',
      what: 'approving a deployment',
      pattern: /\bgh\s+api\b.*pending_deployments.*\s-f\b/,
    },
  ];

  test.each([
    ['gh secret set', 'gh secret set X < key'],
    ['gh secret delete', 'gh secret delete X'],
    ['gh variable set', 'gh variable set X --body 1'],
    [
      'gh api with a body flag',
      'gh api repos/o/r/actions/runs/9/pending_deployments -f state=approved',
    ],
    ['under cd and &&', 'cd x && gh secret set X'],
    ['under sudo', 'sudo gh secret delete X'],
  ])('%s asks with the pattern', (_label, command) => {
    expect(hitsOf({ command, extra: GH })).toEqual([expect.stringContaining('V-W-03')]);
  });

  test.each([
    [
      'an issue body that quotes the command',
      'gh issue create --title t --body "run gh secret set X by hand"',
    ],
    ['a pull request body', 'gh pr create --title t --body "gh secret delete X is the owner\'s"'],
    [
      'a pull request comment',
      'gh pr comment 5 --body "gh api pending_deployments -f state=approved"',
    ],
    ['a release note', 'gh release create v1 --notes "gh secret set"'],
    ['a read', 'gh secret list'],
    ['a read of the api', 'gh api repos/o/r/environments'],
  ])('%s stays quiet', (_label, command) => {
    expect(hitsOf({ command, extra: GH })).toEqual([]);
  });

  test('commandTextsOf keeps the whole request of gh api, gh secret and gh variable, and only the name of the others', () => {
    expect(commandTextsOf({ command: 'gh secret set X', withMessages: true })).toEqual([
      'gh secret set X',
    ]);
    expect(
      commandTextsOf({ command: 'gh api -X PUT repos/o/r/rulesets', withMessages: true }),
    ).toEqual(['gh api -X PUT repos/o/r/rulesets']);
    expect(commandTextsOf({ command: 'gh -R o/r variable set X', withMessages: true })).toEqual([
      'gh -R o/r variable set X',
    ]);
    expect(
      commandTextsOf({ command: 'gh pr create --body "gh secret set"', withMessages: true }),
    ).toEqual(['gh']);
    expect(commandTextsOf({ command: 'gh issue list', withMessages: true })).toEqual(['gh']);
  });
});

describe('guard-git asks for the push targets the project lists', () => {
  test('git push origin develop: not asked without the list, asked with it', () => {
    expect(gitHits({ command: 'git push origin develop' })).toEqual([]);

    const hits = gitHits({ command: 'git push origin develop', askPush: ['develop'] });

    expect(hits.map((hit) => hit.decision)).toEqual(['ask']);
    expect(hits[0].rule).toBe('V-W-06');
    expect(hits[0].message).toContain("'develop'");
    expect(hits[0].message).toContain('guard.git.askPush');
  });

  test('a listed name is a whole branch name; * matches any run of characters', () => {
    const listed = ['develop', 'release/*'];

    expect(gitHits({ command: 'git push origin feature/develop', askPush: listed })).toEqual([]);
    expect(gitHits({ command: 'git push origin HEAD:release/1.2', askPush: listed }).length).toBe(
      1,
    );
    expect(gitHits({ command: 'git push origin refs/heads/develop', askPush: listed }).length).toBe(
      1,
    );
    expect(gitHits({ command: 'git push origin feature/x', askPush: listed })).toEqual([]);
  });

  test('a push with no refspec goes to the current branch', () => {
    expect(gitHits({ command: 'git push', askPush: ['develop'], current: 'develop' }).length).toBe(
      1,
    );
    expect(gitHits({ command: 'git push', askPush: ['develop'], current: 'topic' })).toEqual([]);
  });

  test.each([
    'cd services/api && git push origin develop',
    'git status; git push origin develop',
    '(git push origin develop)',
    'bash -c "git push origin develop"',
  ])('is found inside a compound command: %s', (command) => {
    expect(gitHits({ command, askPush: ['develop'] }).length).toBeGreaterThan(0);
  });

  test('a force-push to a protected branch is still denied once, not also asked about', () => {
    const hits = gitHits({ command: 'git push --force origin develop', askPush: ['develop'] });

    expect(hits.map((hit) => hit.decision)).toEqual(['deny']);
  });

  test('a push to a listed branch that is also deleting asks only through the base rules', () => {
    const decisions = gitHits({
      command: 'git push origin --delete develop',
      askPush: ['develop'],
    }).map((hit) => hit.decision);

    expect(decisions).toEqual(['deny']);
  });
});

describe('matchesBranch', () => {
  test.each([
    ['develop', ['develop'], true],
    ['develop', ['main'], false],
    ['release/1.2', ['release/*'], true],
    ['release', ['release/*'], false],
    ['feature/release/x', ['release/*'], false],
    ['develop', ['*'], true],
    ['a.b', ['a.b'], true],
    ['axb', ['a.b'], false],
  ])('%s against %j is %s', (name, patterns, expected) => {
    expect(matchesBranch({ name, patterns })).toBe(expected);
  });
});

const manifestWith = (opts: { guard: unknown }): string =>
  createProject({
    files: {
      '.agents/vulcan.manifest.json': JSON.stringify({ schemaVersion: 1, guard: opts.guard }),
    },
  });

describe('readGuardPolicy', () => {
  test('reads the commands and the push targets from the manifest, and compiles the patterns', () => {
    const root = manifestWith({
      guard: undefined,
    });
    const full = manifestWith({
      guard: {
        writes: {
          commands: [
            { rule: 'V-W-03', what: 'deploying', pattern: '\\bmake deploy-', ignoreCase: true },
          ],
        },
        git: { askPush: ['develop'] },
      },
    });

    expect(readGuardPolicy({ root })).toEqual({ commands: [], askPush: [] });

    const policy = readGuardPolicy({ root: full });

    expect(policy.askPush).toEqual(['develop']);
    expect(policy.commands).toHaveLength(1);
    expect(policy.commands[0].pattern.test('MAKE DEPLOY-x')).toBe(true);
    expect(policy.commands[0].rule).toBe('V-W-03');
  });

  test('a project without a manifest, or with one that is not JSON, has no extra patterns', () => {
    expect(readGuardPolicy({ root: createProject({ files: {} }) })).toEqual({
      commands: [],
      askPush: [],
    });
    expect(
      readGuardPolicy({
        root: createProject({ files: { '.agents/vulcan.manifest.json': '{ nope' } }),
      }),
    ).toEqual({ commands: [], askPush: [] });
  });

  test('an entry that is not usable is skipped and the others stay: a bad pattern, an unknown rule, a missing field', () => {
    const root = manifestWith({
      guard: {
        writes: {
          commands: [
            { rule: 'V-W-03', what: 'bad regex', pattern: '(' },
            { rule: 'V-W-99', what: 'unknown rule', pattern: 'x' },
            { rule: 'V-W-02', pattern: 'no what' },
            { rule: 'V-W-02', what: 'good', pattern: 'good-one' },
          ],
        },
        git: { askPush: ['develop', 7, ''] },
      },
    });
    const policy = readGuardPolicy({ root });

    expect(policy.commands.map((check) => check.what)).toEqual(['good']);
    expect(policy.askPush).toEqual(['develop']);
  });
});

const hookRun = (opts: { hook: string; root: string; command: string }) => {
  const child = spawnSyncBounded({
    cmd: [process.execPath, opts.hook],
    env: { ...process.env, CLAUDE_PROJECT_DIR: opts.root, VULCAN_GUARDS: '' },
    // The wire names are snake_case: tuples keep them out of our own property names (V-C-14).
    stdin: Buffer.from(
      JSON.stringify(
        Object.fromEntries([
          ['tool_name', 'Bash'],
          ['tool_input', { command: opts.command }],
          ['cwd', opts.root],
        ]),
      ),
    ),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return { code: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
};

describe('the hooks read the manifest', () => {
  const guard = {
    writes: {
      commands: [
        { rule: 'V-W-02', what: 'running a migration', pattern: '\\bbun run migrate:' },
        { rule: 'V-W-03', what: 'deploying', pattern: '\\bmake deploy-' },
      ],
    },
    git: { askPush: ['develop'] },
  };

  test("guard-writes asks for BANA's migrate and deploy commands, and not for the control", () => {
    const root = manifestWith({ guard });

    for (const command of [
      'bun run migrate:up',
      'make deploy-develop-x',
      'cd a && make deploy-develop-x',
    ]) {
      const result = hookRun({ hook: WRITES_HOOK, root, command });

      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
    }

    expect(hookRun({ hook: WRITES_HOOK, root, command: 'make test' }).stdout).toBe('');
    expect(
      hookRun({
        hook: WRITES_HOOK,
        root: manifestWith({ guard: undefined }),
        command: 'make deploy-develop-x',
      }).stdout,
    ).toBe('');
  });

  test('guard-git asks for git push origin develop when develop is listed, and not for another branch', () => {
    const root = manifestWith({ guard });
    const listed = hookRun({ hook: GIT_HOOK, root, command: 'git push origin develop' });

    expect(JSON.parse(listed.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
    expect(hookRun({ hook: GIT_HOOK, root, command: 'git push origin feature/x' }).stdout).toBe('');
    expect(
      hookRun({
        hook: GIT_HOOK,
        root: manifestWith({ guard: undefined }),
        command: 'git push origin develop',
      }).stdout,
    ).toBe('');
  });

  test('a broken pattern in the manifest does not stop the hook: it says so and uses the rest', () => {
    const root = manifestWith({
      guard: {
        writes: {
          commands: [
            { rule: 'V-W-03', what: 'broken', pattern: '(' },
            { rule: 'V-W-03', what: 'deploying', pattern: '\\bmake deploy-' },
          ],
        },
      },
    });
    const result = hookRun({ hook: WRITES_HOOK, root, command: 'make deploy-x' });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('ignoring');
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
  });
});
