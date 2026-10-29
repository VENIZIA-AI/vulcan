import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReleasePlan, ReleasePlanConstants } from '../plan.ts';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const scratch = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'release-plan-test-'));

  roots.push(root);

  return root;
};

const { DEVELOP_REF, MAIN_REF } = ReleasePlanConstants;

describe('ReleasePlan.kindOf', () => {
  test('a version with a prerelease part is a prerelease, anything else a stable', () => {
    expect(ReleasePlan.kindOf({ version: '0.4.8-0' })).toBe('prerelease');
    expect(ReleasePlan.kindOf({ version: '0.4.8-10' })).toBe('prerelease');
    expect(ReleasePlan.kindOf({ version: '0.4.8' })).toBe('stable');
    expect(ReleasePlan.kindOf({ version: '1.0.0' })).toBe('stable');
  });
});

describe('ReleasePlan.targetOf: the arithmetic of npm version', () => {
  const target = (bump: string, currentVersion: string): string =>
    ReleasePlan.targetOf({ bump, currentVersion, scratchRoot: scratch() });

  test('the first prerelease after a stable ends in -0, the next ones count up', () => {
    expect(target('prerelease', '0.4.7')).toBe('0.4.8-0');
    expect(target('prerelease', '0.4.8-0')).toBe('0.4.8-1');
    expect(target('prerelease', '0.4.8-9')).toBe('0.4.8-10');
  });

  test('prepatch, preminor and premajor start a prerelease of the next version', () => {
    expect(target('prepatch', '0.4.7')).toBe('0.4.8-0');
    expect(target('preminor', '0.4.7')).toBe('0.5.0-0');
    expect(target('premajor', '0.4.7')).toBe('1.0.0-0');
  });

  test('a stable bump over a prerelease: patch, minor and major from 0.4.8-3', () => {
    expect(target('patch', '0.4.8-3')).toBe('0.4.8');
    expect(target('minor', '0.4.8-3')).toBe('0.5.0');
    expect(target('major', '0.4.8-3')).toBe('1.0.0');
  });

  test('the quirk: minor over a prerelease of x.y.0 is x.y.0, not the next minor', () => {
    expect(target('minor', '0.4.0-3')).toBe('0.4.0');
  });

  test('none is the version already there, and the scratch folder is gone afterwards', () => {
    const root = scratch();

    expect(ReleasePlan.targetOf({ bump: 'none', currentVersion: '0.4.7', scratchRoot: root })).toBe(
      '0.4.7',
    );
    expect(
      ReleasePlan.targetOf({ bump: 'patch', currentVersion: '0.4.7', scratchRoot: root }),
    ).toBe('0.4.8');
    expect(readdirSync(root)).toEqual([]);
  });
});

describe('ReleasePlan.checkRef: a version and a branch that belong together', () => {
  test('a prerelease may run from develop and nowhere else', () => {
    expect(ReleasePlan.checkRef({ ref: DEVELOP_REF, kind: 'prerelease' })).toEqual([]);
    expect(ReleasePlan.checkRef({ ref: MAIN_REF, kind: 'prerelease' })).toEqual([
      'a prerelease runs from develop, not main',
    ]);
  });

  test('a stable runs from main, not develop', () => {
    expect(ReleasePlan.checkRef({ ref: DEVELOP_REF, kind: 'stable' })).toEqual([
      'a stable release runs from main, not develop',
    ]);
  });

  test('a stable on main is refused until its own steps exist, and says so', () => {
    expect(ReleasePlan.checkRef({ ref: MAIN_REF, kind: 'stable' })).toEqual([
      ReleasePlanConstants.STABLE_PENDING,
    ]);
    expect(ReleasePlanConstants.STABLE_PENDING).toContain('slice S3');
  });

  test('any other ref is refused for both kinds, naming the ref', () => {
    for (const kind of ['prerelease', 'stable'] as const) {
      expect(ReleasePlan.checkRef({ ref: 'refs/heads/feat/x', kind })[0]).toContain(
        'refs/heads/feat/x',
      );
      expect(ReleasePlan.checkRef({ ref: 'refs/tags/v0.4.7', kind })).toHaveLength(1);
    }
  });
});

describe('ReleasePlan.plan', () => {
  const plan = (bump: string, ref: string, currentVersion: string) =>
    ReleasePlan.plan({ bump, ref, currentVersion, scratchRoot: scratch() });

  test('a prerelease from develop is planned under the next dist-tag with no problem', () => {
    expect(plan('prerelease', DEVELOP_REF, '0.4.7')).toEqual({
      plan: { version: '0.4.8-0', kind: 'prerelease', npmTag: 'next' },
      problems: [],
    });
  });

  test('every bump is judged by the version it gives, so patch, minor, major and none on develop are all refused when they give a stable', () => {
    for (const [bump, current] of [
      ['patch', '0.4.7'],
      ['minor', '0.4.7'],
      ['major', '0.4.7'],
      ['patch', '0.4.8-2'],
      ['none', '0.4.7'],
    ] as const) {
      const result = plan(bump, DEVELOP_REF, current);

      expect(result.plan?.kind, `${bump} from ${current}`).toBe('stable');
      expect(result.plan?.npmTag).toBe('latest');
      expect(result.problems, `${bump} from ${current}`).toEqual([
        'a stable release runs from main, not develop',
      ]);
    }
  });

  test('none over a prerelease version runs from develop, a prerelease bump over a stable runs on main only as a refusal', () => {
    expect(plan('none', DEVELOP_REF, '0.4.8-1').problems).toEqual([]);
    expect(plan('prerelease', MAIN_REF, '0.4.7').problems).toEqual([
      'a prerelease runs from develop, not main',
    ]);
  });

  test('an unknown bump is refused before npm is asked', () => {
    const result = plan('sideways', DEVELOP_REF, '0.4.7');

    expect(result.plan).toBeUndefined();
    expect(result.problems[0]).toContain("the bump 'sideways' is not one of");
  });
});

describe('ReleasePlan.main', () => {
  const setup = (version: string) => {
    const root = scratch();
    const manifest = join(root, 'package.json');
    const output = join(root, 'github-output');
    const summary = join(root, 'github-summary');

    writeFileSync(manifest, `${JSON.stringify({ name: 'x', version })}\n`);
    writeFileSync(output, '');
    writeFileSync(summary, '');

    return {
      manifest,
      output,
      summary,
      env: { GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, RUNNER_TEMP: root },
    };
  };

  test('a prerelease on develop writes version, kind and npm_tag, and a summary that says no approval', () => {
    const { manifest, output, summary, env } = setup('0.4.7');
    const code = ReleasePlan.main({
      args: ['--bump', 'prerelease', '--ref', DEVELOP_REF, '--package', manifest],
      env,
    });

    expect(code).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe('version=0.4.8-0\nkind=prerelease\nnpm_tag=next\n');
    expect(readFileSync(summary, 'utf8')).toContain('Approval: none');
  });

  test('a refusal exits 1 and writes nothing for the later jobs to read', () => {
    const { manifest, output, env } = setup('0.4.7');
    const code = ReleasePlan.main({
      args: ['--bump', 'patch', '--ref', DEVELOP_REF, '--package', manifest],
      env,
    });

    expect(code).toBe(1);
    expect(readFileSync(output, 'utf8')).toBe('');
  });

  test('missing flags exit 2', () => {
    expect(ReleasePlan.main({ args: ['--bump', 'patch'], env: {} })).toBe(2);
  });
});
