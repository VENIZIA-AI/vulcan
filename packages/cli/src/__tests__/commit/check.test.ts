import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, initRepo } from '../git-repo.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const SIGNED = 'fix(sync): a thing\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n';
const CLEAN = 'fix(sync): a thing\n\nCo-authored-by: Jane Doe <jane@example.dev>\n';

/** A project whose manifest has the `commit.message` block `vulcan sync` writes. */
const projectWith = (opts: { message?: object }): string =>
  createProject({
    files:
      opts.message === undefined
        ? {}
        : {
            '.agents/vulcan.manifest.json': JSON.stringify({ commit: { message: opts.message } }),
          },
  });

const checkFile = (opts: { root: string; message: string }) => {
  const file = join(opts.root, 'MSG');

  writeFileSync(file, opts.message);

  return runCli({ args: ['commit-check', file], cwd: opts.root });
};

describe('vulcan commit-check <message-file>', () => {
  test('a project that turned nothing on is told so and nothing is checked', () => {
    const result = checkFile({ root: projectWith({}), message: SIGNED });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('no commit check is configured (commit.message in');
  });

  test('a clean message passes and prints nothing', () => {
    const result = checkFile({
      root: projectWith({ message: { agent: { signature: 'deny' } } }),
      message: CLEAN,
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
  });

  test('a signed message fails and names the line', () => {
    const result = checkFile({
      root: projectWith({ message: { agent: { signature: 'deny' } } }),
      message: SIGNED,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('commit-check: 1 problem');
    expect(result.stderr).toContain(
      'line 3: "Co-Authored-By: Claude <noreply@anthropic.com>" signs the commit as an agent',
    );
  });

  test('with agentSignature allow, a signed message passes (only the subject is checked)', () => {
    const root = projectWith({
      message: { agent: { signature: 'allow' }, subject: { pattern: '^fix' } },
    });

    expect(checkFile({ root, message: SIGNED }).code).toBe(0);
  });

  test('the subject shape fails a message that does not match, and shows the hint', () => {
    const root = projectWith({
      message: {
        agent: { signature: 'allow' },
        subject: { pattern: '^\\[#\\d+\\] ', hint: '[#N] type: subject' },
      },
    });
    const result = checkFile({ root, message: 'fix the thing\n' });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('line 1: "fix the thing" does not match the shape');
    expect(result.stderr).toContain('[#N] type: subject');
  });

  test('a project agent is part of the check', () => {
    const root = projectWith({ message: { agent: { signature: 'deny', names: ['windsurf'] } } });

    expect(
      checkFile({ root, message: 'fix: a\n\nCo-authored-by: Windsurf <w@x.dev>\n' }).code,
    ).toBe(1);
  });

  test('a message file that is not there is a usage error, not a pass', () => {
    const root = projectWith({ message: { agent: { signature: 'deny' } } });
    const result = runCli({ args: ['commit-check', join(root, 'nope')], cwd: root });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('cannot read');
  });
});

describe('vulcan commit-check --text and --range', () => {
  test('--text checks the message given', () => {
    const root = projectWith({ message: { agent: { signature: 'deny' } } });

    expect(runCli({ args: ['commit-check', '--text', CLEAN], cwd: root }).code).toBe(0);
    expect(runCli({ args: ['commit-check', '--text', SIGNED], cwd: root }).code).toBe(1);
  });

  test('--range checks every commit of the range and names the signed one', () => {
    const root = projectWith({ message: { agent: { signature: 'deny' } } });

    initRepo({ cwd: root });
    git({ cwd: root, args: ['commit', '--allow-empty', '-q', '-m', CLEAN] });

    const base = git({ cwd: root, args: ['rev-parse', 'HEAD'] });

    git({ cwd: root, args: ['commit', '--allow-empty', '-q', '-m', 'fix: ok'] });
    git({ cwd: root, args: ['commit', '--allow-empty', '-q', '-m', SIGNED] });

    const bad = git({ cwd: root, args: ['rev-parse', '--short', 'HEAD'] });
    const result = runCli({ args: ['commit-check', '--range', `${base}..HEAD`], cwd: root });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`commit ${bad.slice(0, 7)}`);
    expect(result.stderr).toContain('1 problem');
    expect(runCli({ args: ['commit-check', '--range', `${base}..${base}`], cwd: root }).code).toBe(
      0,
    );
  });

  test('a range git cannot read is a usage error', () => {
    const root = projectWith({ message: { agent: { signature: 'deny' } } });

    initRepo({ cwd: root });

    const result = runCli({ args: ['commit-check', '--range', 'nope..HEAD'], cwd: root });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('git log nope..HEAD failed');
  });
});

describe('a CRLF message', () => {
  const CRLF = 'fix(sync): a thing\r\n\r\nCo-Authored-By: Claude <noreply@anthropic.com>\r\n';

  test('is read the same from a file, from --text and from a range', () => {
    const root = projectWith({ message: { agent: { signature: 'deny' } } });

    initRepo({ cwd: root });

    const base = git({ cwd: root, args: ['rev-parse', 'HEAD'] });

    writeFileSync(join(root, 'CRLF'), CRLF);
    git({ cwd: root, args: ['commit', '--allow-empty', '-q', '--cleanup=verbatim', '-F', 'CRLF'] });

    expect(checkFile({ root, message: CRLF }).code).toBe(1);
    expect(runCli({ args: ['commit-check', '--text', CRLF], cwd: root }).code).toBe(1);
    expect(runCli({ args: ['commit-check', '--range', `${base}..HEAD`], cwd: root }).code).toBe(1);
  });
});

describe('git commit -v', () => {
  test('a diff below the scissors line is not part of the message', () => {
    const root = projectWith({ message: { agent: { signature: 'deny' } } });
    const message =
      'fix(sync): a thing\n\n# ------------------------ >8 ------------------------\n+Co-Authored-By: Claude <noreply@anthropic.com>\n';

    expect(checkFile({ root, message }).code).toBe(0);
  });
});

describe('--range is a revision, never an option', () => {
  test('an option-shaped range is refused and writes nothing', () => {
    const root = projectWith({ message: { agent: { signature: 'deny' } } });

    initRepo({ cwd: root });

    const target = join(root, 'written-by-git');
    const result = runCli({ args: ['commit-check', '--range', `--output=${target}`], cwd: root });

    expect(result.code).toBe(2);
    expect(existsSync(target)).toBe(false);
  });
});

describe('the arguments', () => {
  const root = projectWith({ message: { agent: { signature: 'deny' } } });

  test('bad input is a usage error even when no check is configured', () => {
    const bare = projectWith({});

    expect(runCli({ args: ['commit-check'], cwd: bare }).code).toBe(2);
    expect(runCli({ args: ['commit-check', '--range'], cwd: bare }).code).toBe(2);
    expect(runCli({ args: ['commit-check', 'a', 'b'], cwd: bare }).code).toBe(2);
    expect(runCli({ args: ['commit-check', '--bogus'], cwd: bare }).code).toBe(2);
  });

  test('two files are a usage error', () => {
    expect(runCli({ args: ['commit-check', 'a', 'b'], cwd: root }).code).toBe(2);
  });

  test('exactly one of a file, --text or --range', () => {
    expect(runCli({ args: ['commit-check'], cwd: root }).code).toBe(2);
    expect(runCli({ args: ['commit-check', 'a', '--text', 'b'], cwd: root }).code).toBe(2);
    expect(runCli({ args: ['commit-check', '--text', 'a', '--range', 'b'], cwd: root }).code).toBe(
      2,
    );
  });

  test('an unknown flag is refused by the router', () => {
    const result = runCli({ args: ['commit-check', '--all'], cwd: root });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unknown argument '--all'");
  });
});
