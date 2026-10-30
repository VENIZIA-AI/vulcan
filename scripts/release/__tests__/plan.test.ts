import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MergeBackConstants, ReleaseMergeBack } from '../merge-back.ts';
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

const git = (opts: { cwd: string; args: string[] }): string =>
  ReleaseMergeBack.mustGit({ cwd: opts.cwd, args: [...MergeBackConstants.IDENTITY, ...opts.args] });

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

  test('none is the version already there, and a bump leaves no scratch folder behind', () => {
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

  test('a stable on main is allowed', () => {
    expect(ReleasePlan.checkRef({ ref: MAIN_REF, kind: 'stable' })).toEqual([]);
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

describe('ReleasePlan.checkPromotion: a stable bump promotes a prerelease', () => {
  test('patch, minor and major over a stable are refused, naming the version', () => {
    for (const bump of ['patch', 'minor', 'major']) {
      const problems = ReleasePlan.checkPromotion({
        bump,
        currentVersion: '0.4.9',
        kind: ReleasePlan.kindOf({
          version: ReleasePlan.targetOf({ bump, currentVersion: '0.4.9', scratchRoot: scratch() }),
        }),
      });

      expect(problems, bump).toHaveLength(1);
      expect(problems[0]).toContain('0.4.9');
    }
  });

  test('over a prerelease they are allowed, and none is allowed over a stable (it heals a half-finished run)', () => {
    expect(
      ReleasePlan.checkPromotion({ bump: 'patch', currentVersion: '0.4.9-3', kind: 'stable' }),
    ).toEqual([]);
    expect(
      ReleasePlan.checkPromotion({ bump: 'none', currentVersion: '0.4.9', kind: 'stable' }),
    ).toEqual([]);
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

  test('a stable on main is planned under the latest dist-tag: patch, minor and major over a prerelease', () => {
    for (const [bump, version] of [
      ['patch', '0.4.9'],
      ['minor', '0.5.0'],
      ['major', '1.0.0'],
    ] as const) {
      expect(plan(bump, MAIN_REF, '0.4.9-3'), bump).toEqual({
        plan: { version, kind: 'stable', npmTag: 'latest' },
        problems: [],
      });
    }
  });

  test('the quirk shows in the target: minor over 0.4.0-3 on main is 0.4.0', () => {
    expect(plan('minor', MAIN_REF, '0.4.0-3').plan?.version).toBe('0.4.0');
  });

  test('a stable bump on main over a stable is refused, and none over it is not', () => {
    expect(plan('patch', MAIN_REF, '0.4.9').problems[0]).toContain('nothing to promote');
    expect(plan('none', MAIN_REF, '0.4.9').problems).toEqual([]);
  });

  test('an unknown bump is refused before npm is asked', () => {
    const result = plan('sideways', DEVELOP_REF, '0.4.7');

    expect(result.plan).toBeUndefined();
    expect(result.problems[0]).toContain("the bump 'sideways' is not one of");
  });
});

describe('ReleasePlan.plan: what the later jobs may carry', () => {
  const plan = (opts: { bump?: string; currentVersion?: string; issue?: string }) =>
    ReleasePlan.plan({
      bump: opts.bump ?? 'prerelease',
      ref: DEVELOP_REF,
      currentVersion: opts.currentVersion ?? '0.4.7',
      issue: opts.issue,
      scratchRoot: scratch(),
    });

  test('a version with a newline, a build part or anything but digits and a prerelease part is refused', () => {
    for (const currentVersion of ['0.4.8-1\nNAME=value', '1.0.0+a-b', 'v0.4.8', '0.4', '0.4.8-']) {
      const result = plan({ bump: 'none', currentVersion });

      expect(result.plan, currentVersion).toBeUndefined();
      expect(result.problems[0], currentVersion).toContain('is not a plain version');
    }
  });

  test('an issue is a number or nothing', () => {
    expect(plan({ issue: '549' }).problems).toEqual([]);
    expect(plan({ issue: '' }).problems).toEqual([]);
    expect(plan({ issue: undefined }).problems).toEqual([]);
    expect(plan({ issue: '12\nCo-Authored-By: x' }).problems[0]).toContain('must be a number');
    expect(plan({ issue: 'abc' }).plan).toBeUndefined();
  });

  test('a refused issue is quoted, so a line it carries cannot start with a log command', () => {
    const [problem] = plan({ issue: '1\n::error::x' }).problems;

    expect(problem).toBe('the issue must be a number, not "1\\n::error::x"');
    expect(problem).not.toContain('\n');
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
    expect(readFileSync(output, 'utf8')).toBe(
      'version=0.4.8-0\nkind=prerelease\nnpm_tag=next\ndevelop_sha=\n',
    );
    expect(readFileSync(summary, 'utf8')).toContain('Approval: none');
  });

  test('a stable on main writes kind=stable, and the summary says one approval', () => {
    const { manifest, output, summary, env } = setup('0.4.9-3');
    const code = ReleasePlan.main({
      args: ['--bump', 'patch', '--ref', MAIN_REF, '--package', manifest],
      env,
    });

    expect(code).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe(
      'version=0.4.9\nkind=stable\nnpm_tag=latest\ndevelop_sha=\n',
    );
    expect(readFileSync(summary, 'utf8')).toContain('one approval');
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

describe('ReleasePlan.main: an --issue that is not a number', () => {
  const setup = (): { manifest: string; env: Record<string, string> } => {
    const root = scratch();
    const manifest = join(root, 'package.json');

    writeFileSync(manifest, `${JSON.stringify({ name: 'x', version: '0.4.7' })}\n`);

    return { manifest, env: { RUNNER_TEMP: root } };
  };
  const issue = (value: string): number => {
    const { manifest, env } = setup();

    return ReleasePlan.main({
      args: ['--bump', 'prerelease', '--ref', DEVELOP_REF, '--package', manifest, '--issue', value],
      env,
    });
  };

  test('is refused even when it looks like a flag, because the workflow passes the same input to the commit', () => {
    expect(issue('--evil\nCo-Authored-By: x')).toBe(1);
    expect(issue('--5')).toBe(1);
    expect(issue('abc')).toBe(1);
    expect(issue('549')).toBe(0);
    expect(issue('')).toBe(0);
  });
});

describe('ReleasePlan: one train, one version', () => {
  const trainOf = (versions: Record<string, string>): string => {
    const root = scratch();

    for (const [name, version] of Object.entries(versions)) {
      mkdirSync(join(root, name), { recursive: true });
      writeFileSync(
        join(root, name, 'package.json'),
        `${JSON.stringify({ name: `@x/${name}`, version })}\n`,
      );
    }

    return root;
  };

  test('readTrain lists name@version for every package folder, and trainProblems names the ones that differ', () => {
    const train = ReleasePlan.readTrain({
      directory: trainOf({ okf: '0.4.9-3', atlas: '0.4.9-3', cli: '0.4.9-2' }),
    });

    expect(train.sort()).toEqual(['@x/atlas@0.4.9-3', '@x/cli@0.4.9-2', '@x/okf@0.4.9-3']);
    expect(ReleasePlan.trainProblems({ train, version: '0.4.9-3' })[0]).toContain('@x/cli@0.4.9-2');
    expect(
      ReleasePlan.trainProblems({ train: ['@x/a@0.4.9-3', '@x/b@0.4.9-3'], version: '0.4.9-3' }),
    ).toEqual([]);
  });

  test('main refuses a train that differs before anything else, and lists the packages in the summary when it agrees', () => {
    const root = scratch();
    const manifest = join(root, 'package.json');
    const summary = join(root, 'summary');
    const agreeing = trainOf({ okf: '0.4.7', cli: '0.4.7' });
    const differing = trainOf({ okf: '0.4.6', cli: '0.4.7' });

    writeFileSync(manifest, `${JSON.stringify({ name: 'x', version: '0.4.7' })}\n`);
    writeFileSync(summary, '');

    const run = (train: string) =>
      ReleasePlan.main({
        args: [
          '--bump',
          'prerelease',
          '--ref',
          DEVELOP_REF,
          '--package',
          manifest,
          '--train',
          train,
        ],
        env: { RUNNER_TEMP: root, GITHUB_STEP_SUMMARY: summary },
      });

    expect(run(differing)).toBe(1);
    expect(run(agreeing)).toBe(0);
    expect(readFileSync(summary, 'utf8')).toContain('Packages: @x/');
  });
});

describe('ReleasePlan: the run title the dispatcher sends', () => {
  const TRAIN = [
    '@venizia/vulcan-okf@0.4.8-0',
    '@venizia/vulcan-atlas@0.4.8-0',
    '@venizia/vulcan@0.4.8-0',
  ];
  const SHA = '285d5bd976bb5a35753096698001472a5f0a17eb';

  test('shortNameOf drops the scope and the vulcan- prefix, and the bare package is vulcan', () => {
    expect(ReleasePlan.shortNameOf({ entry: '@venizia/vulcan-okf@0.4.8' })).toBe('okf');
    expect(ReleasePlan.shortNameOf({ entry: '@venizia/vulcan-atlas@0.4.8' })).toBe('atlas');
    expect(ReleasePlan.shortNameOf({ entry: '@venizia/vulcan@0.4.8' })).toBe('vulcan');
    expect(ReleasePlan.shortNameOf({ entry: 'plain@1.0.0' })).toBe('plain');
  });

  test('labelOf is the version and kind, the sorted package names, the issue and the seven-character commit', () => {
    expect(
      ReleasePlan.labelOf({
        version: '0.4.8',
        kind: 'stable',
        train: TRAIN,
        issue: '581',
        sha: SHA,
      }),
    ).toBe('0.4.8 stable · atlas,okf,vulcan · #581 · 285d5bd');
  });

  test('no issue and no commit leave their parts out', () => {
    expect(ReleasePlan.labelOf({ version: '0.4.8-0', kind: 'prerelease', train: TRAIN })).toBe(
      '0.4.8-0 prerelease · atlas,okf,vulcan',
    );
    expect(
      ReleasePlan.labelOf({
        version: '0.4.8-0',
        kind: 'prerelease',
        train: TRAIN,
        issue: '',
        sha: '',
      }),
    ).toBe('0.4.8-0 prerelease · atlas,okf,vulcan');
  });

  test('the order of the train does not change the label', () => {
    const reversed = [...TRAIN].reverse();

    expect(ReleasePlan.labelOf({ version: '1.0.0', kind: 'stable', train: reversed })).toBe(
      ReleasePlan.labelOf({ version: '1.0.0', kind: 'stable', train: TRAIN }),
    );
  });

  test('labelProblems accepts the expected label and an empty or absent one, and refuses any other', () => {
    const expected = '0.4.8 stable · atlas,okf,vulcan · #581 · 285d5bd';

    expect(ReleasePlan.labelProblems({ label: expected, expected })).toEqual([]);
    expect(ReleasePlan.labelProblems({ label: '', expected })).toEqual([]);
    expect(ReleasePlan.labelProblems({ label: undefined, expected })).toEqual([]);
    expect(
      ReleasePlan.labelProblems({ label: '0.4.9 stable · atlas,okf,vulcan', expected })[0],
    ).toContain('is not what the plan computes');
  });

  test('quoted writes control, zero-width and bidirectional characters as escapes', () => {
    const text = `a${String.fromCodePoint(0x202e)}b${String.fromCodePoint(0x200b)}c${String.fromCodePoint(0xe0041)}\n"d"`;

    expect(ReleasePlan.quoted({ text })).toBe('"a\\u202eb\\u200bc\\u{e0041}\\n\\"d\\""');
    expect(ReleasePlan.quoted({ text: '0.4.8 stable · atlas,okf,vulcan' })).toBe(
      '"0.4.8 stable · atlas,okf,vulcan"',
    );
  });

  test('a refused label is quoted with its hidden characters written out', () => {
    const [problem] = ReleasePlan.labelProblems({
      label: `::error::x${String.fromCodePoint(0x202e)}`,
      expected: '0.4.8 stable',
    });

    expect(problem).toContain('"::error::x\\u202e"');
    expect(problem).not.toContain(String.fromCodePoint(0x202e));
  });

  test('only a workflow that declares the label input can be sent one', () => {
    const declared =
      'name: Release\non:\n  workflow_dispatch:\n    inputs:\n      label:\n        type: string\n\njobs:\n  plan:\n    name: Plan\n';
    const before =
      'name: NPM Release\non:\n  workflow_dispatch:\n    inputs:\n      issue:\n        type: string\n\njobs:\n  plan:\n    name: Plan\n';

    expect(ReleasePlan.declaresLabel({ workflow: declared })).toBe(true);
    expect(ReleasePlan.declaresLabel({ workflow: before })).toBe(false);
    // A `label:` further down, in a job or a step, is not an input.
    expect(
      ReleasePlan.declaresLabel({
        workflow: `${before}    steps:\n      - name: x\n        with:\n          label: y\n`,
      }),
    ).toBe(false);
    expect(
      ReleasePlan.declaresLabel({
        workflow: 'on:\n  push:\n    inputs:\n      label:\n        type: string\n',
      }),
    ).toBe(false);
    expect(ReleasePlan.declaresLabel({ workflow: '' })).toBe(false);
    expect(ReleasePlan.declaresLabel({ workflow: 'on: [unclosed' })).toBe(false);
  });

  test('the real workflow declares the label input', () => {
    expect(
      ReleasePlan.declaresLabel({
        workflow: readFileSync(
          join(import.meta.dir, '..', '..', '..', '.github', 'workflows', 'package-release.yml'),
          'utf8',
        ),
      }),
    ).toBe(true);
  });

  describe('main', () => {
    const run = (opts: { label?: string; sha?: string }): number => {
      const root = scratch();
      const manifest = join(root, 'package.json');
      const train = join(root, 'train');

      writeFileSync(manifest, `${JSON.stringify({ name: 'x', version: '0.4.7' })}\n`);

      for (const name of ['okf', 'cli']) {
        mkdirSync(join(train, name), { recursive: true });
        writeFileSync(
          join(train, name, 'package.json'),
          `${JSON.stringify({ name: `@venizia/vulcan${name === 'cli' ? '' : `-${name}`}`, version: '0.4.7' })}\n`,
        );
      }

      return ReleasePlan.main({
        args: [
          '--bump',
          'prerelease',
          '--ref',
          DEVELOP_REF,
          '--issue',
          '12',
          ...(opts.label === undefined ? [] : ['--label', opts.label]),
          '--package',
          manifest,
          '--train',
          train,
        ],
        env: { RUNNER_TEMP: root, GITHUB_SHA: opts.sha ?? SHA },
      });
    };

    test('a label that is the plan own is accepted, as is no label', () => {
      expect(run({ label: '0.4.8-0 prerelease · okf,vulcan · #12 · 285d5bd' })).toBe(0);
      expect(run({ label: '' })).toBe(0);
      expect(run({})).toBe(0);
    });

    test('a label with another version, package set, issue or commit is refused', () => {
      expect(run({ label: '0.4.9-0 prerelease · okf,vulcan · #12 · 285d5bd' })).toBe(1);
      expect(run({ label: '0.4.8-0 prerelease · okf · #12 · 285d5bd' })).toBe(1);
      expect(run({ label: '0.4.8-0 prerelease · okf,vulcan · #13 · 285d5bd' })).toBe(1);
      expect(
        run({ label: '0.4.8-0 prerelease · okf,vulcan · #12 · 285d5bd', sha: 'ffffffff' }),
      ).toBe(1);
    });

    test('a label that starts with -- is read as given and refused, not skipped as a missing value', () => {
      expect(run({ label: '--merge-trial' })).toBe(1);
    });

    test('a label that is --train cannot make plan skip the train and the label checks', () => {
      expect(run({ label: '--train' })).toBe(2);
    });

    test('the refusal quotes the label, so a newline or a :: line cannot forge a log line', () => {
      const [problem] = ReleasePlan.labelProblems({
        label: 'x\n::add-mask::y',
        expected: '0.4.8 stable',
      });

      expect(problem).toContain('"x\\n::add-mask::y"');
      expect(problem).not.toContain('\n');
    });
  });
});

describe('ReleasePlan.main: --merge-trial', () => {
  /** A repository where main is at 0.1.0-0 and develop one prerelease ahead, with the refs a clone has. */
  const repository = (): { root: string; mainSha: string; developSha: string } => {
    const root = scratch();
    const manifest = (version: string): string =>
      `${JSON.stringify({ name: '@x/cli', version }, null, 2)}\n`;

    git({ cwd: root, args: ['init', '-q', '-b', 'main'] });
    mkdirSync(join(root, 'packages', 'cli'), { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      `${JSON.stringify({ name: 'x', private: true, workspaces: ['packages/*'] }, null, 2)}\n`,
    );
    writeFileSync(join(root, 'packages', 'cli', 'package.json'), manifest('0.1.0-0'));
    writeFileSync(join(root, 'shared.txt'), 'one\n');
    git({ cwd: root, args: ['add', '-A'] });
    git({ cwd: root, args: ['commit', '-q', '-m', 'sync'] });

    const mainSha = git({ cwd: root, args: ['rev-parse', 'HEAD'] });

    git({ cwd: root, args: ['checkout', '-q', '-b', 'develop'] });
    writeFileSync(join(root, 'packages', 'cli', 'package.json'), manifest('0.1.0-1'));
    git({ cwd: root, args: ['commit', '-q', '-am', 'chore(release): v0.1.0-1'] });
    git({ cwd: root, args: ['update-ref', 'refs/remotes/origin/develop', 'develop'] });
    git({ cwd: root, args: ['checkout', '-q', 'main'] });

    return { root, mainSha, developSha: git({ cwd: root, args: ['rev-parse', 'develop'] }) };
  };

  const run = (opts: { root: string; mainSha: string }) => {
    const output = join(opts.root, '..', `output-${Date.now()}`);

    writeFileSync(output, '');

    const code = ReleasePlan.main({
      args: [
        '--bump',
        'patch',
        '--ref',
        MAIN_REF,
        '--package',
        join(opts.root, 'packages', 'cli', 'package.json'),
        '--merge-trial',
      ],
      env: { RUNNER_TEMP: scratch(), GITHUB_OUTPUT: output, GITHUB_SHA: opts.mainSha },
      cwd: opts.root,
    });

    return { code, output: readFileSync(output, 'utf8') };
  };

  test('a stable whose merge back goes through hands develop_sha on', () => {
    const { root, mainSha, developSha } = repository();

    expect(run({ root, mainSha })).toEqual({
      code: 0,
      output: `version=0.1.0\nkind=stable\nnpm_tag=latest\ndevelop_sha=${developSha}\n`,
    });
  });

  test('a stable whose merge back would stop exits 1 and writes nothing for the later jobs', () => {
    const { root, mainSha } = repository();

    writeFileSync(join(root, 'shared.txt'), 'main edit\n');
    ReleaseMergeBack.mustGit({
      cwd: root,
      args: [...MergeBackConstants.IDENTITY, 'commit', '-q', '-am', 'main edits shared'],
    });

    const mainNow = ReleaseMergeBack.mustGit({ cwd: root, args: ['rev-parse', 'HEAD'] });

    ReleaseMergeBack.mustGit({
      cwd: root,
      args: [...MergeBackConstants.IDENTITY, 'checkout', '-q', 'develop'],
    });
    writeFileSync(join(root, 'shared.txt'), 'develop edit\n');
    ReleaseMergeBack.mustGit({
      cwd: root,
      args: [...MergeBackConstants.IDENTITY, 'commit', '-q', '-am', 'develop edits shared'],
    });
    ReleaseMergeBack.mustGit({
      cwd: root,
      args: ['update-ref', 'refs/remotes/origin/develop', 'develop'],
    });
    ReleaseMergeBack.mustGit({ cwd: root, args: ['checkout', '-q', 'main'] });

    expect(mainSha).not.toBe(mainNow);
    expect(run({ root, mainSha: mainNow })).toEqual({ code: 1, output: '' });
  });
});

describe('ReleasePlan.main: a stable and the changelog', () => {
  const stable = (opts: { root: string }): number =>
    ReleasePlan.main({
      args: [
        '--bump',
        'patch',
        '--ref',
        MAIN_REF,
        '--package',
        join(opts.root, 'packages', 'cli', 'package.json'),
      ],
      env: { RUNNER_TEMP: scratch() },
      cwd: opts.root,
    });

  test('a stable with no changelog entry is planned, and so is one with an entry: the changelog records only what affects users', () => {
    const root = scratch();

    git({ cwd: root, args: ['init', '-q', '-b', 'main'] });
    mkdirSync(join(root, 'packages', 'cli'), { recursive: true });
    mkdirSync(join(root, '.agents'), { recursive: true });
    mkdirSync(join(root, 'docs', 'changelogs'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'cli', 'package.json'),
      `${JSON.stringify({ name: '@x/cli', version: '0.1.0-0' }, null, 2)}\n`,
    );
    writeFileSync(
      join(root, '.agents', 'vulcan.manifest.json'),
      `${JSON.stringify({
        release: { tagPattern: 'vulcan-v<version>' },
        knowledge: { changelogs: 'docs/changelogs' },
        packages: [{ name: '@x/cli' }],
      })}\n`,
    );
    git({ cwd: root, args: ['add', '-A'] });
    git({ cwd: root, args: ['commit', '-q', '-m', 'sync'] });

    expect(stable({ root })).toBe(0);

    writeFileSync(
      join(root, 'docs', 'changelogs', '2026-10-30-a.md'),
      '---\ntitle: a\n---\n\n# Changelog - 2026-10-30\n\nA change.\n',
    );
    git({ cwd: root, args: ['add', '-A'] });
    git({ cwd: root, args: ['commit', '-q', '-m', 'an entry'] });

    expect(stable({ root })).toBe(0);
  });
});
