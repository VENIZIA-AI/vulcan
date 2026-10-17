import { describe, expect, test } from 'bun:test';
import {
  buildDispatchCommand,
  findPublishedVersions,
  findReleaseBlockers,
  parseReleaseArgs,
} from '../release-args.ts';

describe('parseReleaseArgs', () => {
  test('defaults: prerelease from IGNIS develop, no issue, asks before dispatching', () => {
    expect(parseReleaseArgs({ args: [] })).toEqual({
      bump: 'prerelease',
      ignisRef: 'develop',
      issue: undefined,
      isDryRun: false,
      isConfirmed: false,
    });
  });

  test('every flag and its value are read', () => {
    const parsed = parseReleaseArgs({
      args: ['--bump', 'none', '--issue', '12', '--ignis-ref', 'main', '--dry-run', '--yes'],
    });

    expect(parsed).toEqual({
      bump: 'none',
      ignisRef: 'main',
      issue: '12',
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
});

describe('buildDispatchCommand', () => {
  test('dispatches package-release.yml on the default branch (develop) with every input, as IGNIS does', () => {
    const command = buildDispatchCommand({
      args: {
        bump: 'prerelease',
        ignisRef: 'develop',
        issue: '12',
        isDryRun: false,
        isConfirmed: true,
      },
    });

    expect(command).toEqual([
      'gh',
      'workflow',
      'run',
      'package-release.yml',
      '-f',
      'bump=prerelease',
      '-f',
      'ignis_ref=develop',
      '-f',
      'issue=12',
    ]);
  });

  test('no issue sends no issue input', () => {
    const command = buildDispatchCommand({
      args: {
        bump: 'none',
        ignisRef: 'develop',
        issue: undefined,
        isDryRun: false,
        isConfirmed: false,
      },
    });

    expect(command).not.toContain('-f issue=');
    expect(command.some(part => part.startsWith('issue='))).toBe(false);
  });
});

describe('findReleaseBlockers', () => {
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
  test("reads bun publish's own '+ <name>@<version>' lines, never an echo of them", () => {
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
