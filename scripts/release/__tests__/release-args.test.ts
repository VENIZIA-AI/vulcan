import { describe, expect, test } from 'bun:test';
import {
  buildDispatchCommand,
  findPublishedVersions,
  findReleaseBlockers,
  parseReleaseArgs,
} from '../release-args.ts';

describe('parseReleaseArgs', () => {
  test('defaults: prerelease, no issue, asks before dispatching', () => {
    expect(parseReleaseArgs({ args: [] })).toEqual({
      bump: 'prerelease',
      issue: undefined,
      branch: 'develop',
      isDryRun: false,
      isConfirmed: false,
    });
  });

  test('a bump that gives a stable runs from main, any other from develop, and none follows --branch', () => {
    for (const [bump, branch] of [
      ['prerelease', 'develop'],
      ['prepatch', 'develop'],
      ['preminor', 'develop'],
      ['premajor', 'develop'],
      ['patch', 'main'],
      ['minor', 'main'],
      ['major', 'main'],
      ['none', 'develop'],
    ] as const) {
      expect(parseReleaseArgs({ args: ['--bump', bump] }).branch, bump).toBe(branch);
    }

    expect(parseReleaseArgs({ args: ['--bump', 'none', '--branch', 'main'] }).branch).toBe('main');
  });

  test('a branch other than develop or main throws', () => {
    expect(() => parseReleaseArgs({ args: ['--branch', 'feat/x'] })).toThrow(
      "--branch 'feat/x' is not one of: develop, main",
    );
  });

  test('every flag and its value are read', () => {
    const parsed = parseReleaseArgs({
      args: ['--bump', 'none', '--issue', '12', '--dry-run', '--yes'],
    });

    expect(parsed).toEqual({
      bump: 'none',
      issue: '12',
      branch: 'develop',
      isDryRun: true,
      isConfirmed: true,
    });
  });

  test('a bump the workflow does not offer throws, naming the options', () => {
    expect(() => parseReleaseArgs({ args: ['--bump', 'huge'] })).toThrow(
      "--bump 'huge' is not one of: prerelease, prepatch, preminor, premajor, patch, minor, major, none",
    );
  });

  test('an --issue that is not a number throws', () => {
    expect(() => parseReleaseArgs({ args: ['--issue', 'abc'] })).toThrow(
      '--issue needs an issue number, got: abc',
    );
  });

  test('a flag without its value throws', () => {
    expect(() => parseReleaseArgs({ args: ['--bump'] })).toThrow('--bump needs a value');
  });

  test('an unknown argument throws instead of being ignored', () => {
    expect(() => parseReleaseArgs({ args: ['--dryrun'] })).toThrow("unknown argument '--dryrun'");
  });

  test('--ignis-ref is gone: the release ships code only, it packages no IGNIS content', () => {
    expect(() => parseReleaseArgs({ args: ['--ignis-ref', 'main'] })).toThrow(
      "unknown argument '--ignis-ref'",
    );
  });
});

describe('buildDispatchCommand', () => {
  test('dispatches package-release.yml on an explicit ref, develop, with the bump and the issue', () => {
    const command = buildDispatchCommand({
      args: {
        bump: 'prerelease',
        issue: '12',
        branch: 'develop',
        isDryRun: false,
        isConfirmed: true,
      },
    });

    expect(command).toEqual([
      'gh',
      'workflow',
      'run',
      'package-release.yml',
      '--ref',
      'develop',
      '-f',
      'bump=prerelease',
      '-f',
      'issue=12',
    ]);
  });

  test('a label is sent as the label input, and an empty or absent one is not', () => {
    const args = {
      bump: 'patch',
      issue: '581',
      branch: 'main',
      isDryRun: false,
      isConfirmed: true,
    };
    const label = '0.4.8 stable · atlas,okf,vulcan · #581 · 285d5bd';

    expect(buildDispatchCommand({ args, label }).slice(-2)).toEqual(['-f', `label=${label}`]);
    expect(
      buildDispatchCommand({ args, label: '' }).some((part) => part.startsWith('label=')),
    ).toBe(false);
    expect(buildDispatchCommand({ args }).some((part) => part.startsWith('label='))).toBe(false);
  });

  test('no issue sends no issue input', () => {
    const command = buildDispatchCommand({
      args: {
        bump: 'none',
        issue: undefined,
        branch: 'develop',
        isDryRun: false,
        isConfirmed: false,
      },
    });

    expect(command).not.toContain('-f issue=');
    expect(command.some((part) => part.startsWith('issue='))).toBe(false);
  });
});

describe('buildDispatchCommand: a stable', () => {
  test('is dispatched on main', () => {
    const command = buildDispatchCommand({
      args: { bump: 'patch', issue: undefined, branch: 'main', isDryRun: false, isConfirmed: true },
    });

    expect(command.slice(4, 7)).toEqual(['--ref', 'main', '-f']);
  });
});

describe('findReleaseBlockers', () => {
  test('a stable is judged against main, and says so', () => {
    expect(
      findReleaseBlockers({ branch: 'main', dirtyPaths: 0, ahead: 0, behind: 0, target: 'main' }),
    ).toEqual([]);
    expect(
      findReleaseBlockers({
        branch: 'develop',
        dirtyPaths: 0,
        ahead: 0,
        behind: 1,
        target: 'main',
      }),
    ).toEqual([
      "On 'develop', not 'main'. The workflow releases from 'main'.",
      '1 commit(s) behind origin/main. Pull first, or you will read stale versions.',
    ]);
  });

  test('on develop, clean, level with origin: nothing blocks', () => {
    expect(findReleaseBlockers({ branch: 'develop', dirtyPaths: 0, ahead: 0, behind: 0 })).toEqual(
      [],
    );
  });

  test('every way the release would not match the tree is named', () => {
    expect(findReleaseBlockers({ branch: 'main', dirtyPaths: 3, ahead: 2, behind: 1 })).toEqual([
      "On 'main', not 'develop'. The workflow releases from 'develop'.",
      'Working tree is not clean - 3 path(s). The workflow builds from the remote, so uncommitted work would NOT be released.',
      '2 commit(s) not pushed. The workflow builds origin/develop; push first.',
      '1 commit(s) behind origin/develop. Pull first, or you will read stale versions.',
    ]);
  });
});

describe('findPublishedVersions', () => {
  test("reads the '+ <name>@<version>' lines the publish step prints, never an echo of them", () => {
    const log = [
      'release\tPublish to NPM\t + @venizia/vulcan-okf@0.1.0-1',
      'release\tPublish to NPM\t echo "+ @venizia/vulcan-atlas@9.9.9"',
      'release\tPublish to NPM\t + @venizia/vulcan-atlas@0.1.0-1',
    ].join('\n');

    expect(
      findPublishedVersions({
        log,
        packageNames: ['@venizia/vulcan-okf', '@venizia/vulcan-atlas', '@venizia/vulcan'],
      }),
    ).toEqual({
      '@venizia/vulcan-okf': '0.1.0-1',
      '@venizia/vulcan-atlas': '0.1.0-1',
      '@venizia/vulcan': undefined,
    });
  });
});
