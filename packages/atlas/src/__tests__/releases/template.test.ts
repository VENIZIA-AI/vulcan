import { compileReleaseTemplate } from '@/releases';
import { describe, expect, test } from 'bun:test';

const groupsOf = (opts: { template: string; subject: string }) =>
  compileReleaseTemplate({ template: opts.template }).exec(opts.subject)?.groups;

describe('compileReleaseTemplate', () => {
  const IGNIS_FORM = '[#<issue>] chore(<dir>): release v<version>';

  test('the IGNIS form reads the directory and the version, the mode tolerated', () => {
    expect(
      groupsOf({ template: IGNIS_FORM, subject: 'chore(core-server): release v0.1.5 [patch]' }),
    ).toMatchObject({ dir: 'core-server', version: '0.1.5' });
  });

  test('the leading issue is optional and may repeat', () => {
    expect(
      groupsOf({
        template: IGNIS_FORM,
        subject: '[#80][#81] chore(kernel): release v0.2.1-0 [prerelease]',
      }),
    ).toMatchObject({ dir: 'kernel', version: '0.2.1-0' });
    expect(
      groupsOf({ template: IGNIS_FORM, subject: 'chore(kernel): release v0.2.1-0' }),
    ).toMatchObject({ dir: 'kernel', version: '0.2.1-0' });
  });

  test('<package> is a synonym of <dir>', () => {
    expect(
      groupsOf({
        template: 'release(<package>) <version>',
        subject: 'release(kernel) 1.2.3',
      }),
    ).toMatchObject({ dir: 'kernel', version: '1.2.3' });
  });

  test('a train template has no directory: the commit releases every live package', () => {
    const groups = groupsOf({
      template: 'chore(release): v<version>',
      subject: 'chore(release): v0.1.0-2 [prerelease]',
    });

    expect(groups?.version).toBe('0.1.0-2');
    expect(groups?.dir).toBeUndefined();
  });

  test('every other character is literal: a subject that only looks alike does not match', () => {
    expect(
      groupsOf({ template: IGNIS_FORM, subject: 'chore: release v0.2.0-21 [prerelease]' }),
    ).toBeUndefined();
    expect(
      groupsOf({ template: IGNIS_FORM, subject: 'feat(atlas): the symbol tool' }),
    ).toBeUndefined();
    expect(
      groupsOf({ template: 'chore(release): v<version>', subject: 'chore(releaseX): v1.0.0' }),
    ).toBeUndefined();
  });
});
