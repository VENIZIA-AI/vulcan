import { afterAll, describe, expect, test } from 'bun:test';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { AgentSignaturePolicies, CommitPolicy } from '../../commit/index.ts';
import { ProjectManifest } from '../../manifest/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const manifestOf = (opts: { root: string; config: object }): Record<string, unknown> =>
  JSON.parse(
    ProjectManifest.render({ root: opts.root, config: VULCAN_CONFIG_SCHEMA.parse(opts.config) }),
  );

const projectWithManifest = (opts: { manifest: object }): string =>
  createProject({ files: { '.agents/vulcan.manifest.json': JSON.stringify(opts.manifest) } });

describe('AgentSignaturePolicies', () => {
  test('two values, and isValid reads them', () => {
    expect([...AgentSignaturePolicies.SCHEME_SET]).toEqual(['allow', 'deny']);
    expect(AgentSignaturePolicies.isValid('deny')).toBe(true);
    expect(AgentSignaturePolicies.isValid('maybe')).toBe(false);
  });
});

describe('commit.message in the config', () => {
  test('every check is off until the project turns it on', () => {
    expect(VULCAN_CONFIG_SCHEMA.parse({}).commit).toEqual({
      message: { agent: { signature: 'allow', names: [], allow: [] } },
    });
  });

  test('agent.signature, agent.names and a subject shape are accepted', () => {
    const parsed = VULCAN_CONFIG_SCHEMA.parse({
      commit: {
        message: {
          agent: { signature: 'deny', names: ['windsurf'], allow: ['Claude Dupont'] },
          subject: { pattern: '^\\[#\\d+\\] ', hint: '[#N] type: subject' },
        },
      },
    });

    expect(parsed.commit.message.agent).toEqual({
      signature: 'deny',
      names: ['windsurf'],
      allow: ['Claude Dupont'],
    });
    expect(parsed.commit.message.subject).toEqual({
      pattern: '^\\[#\\d+\\] ',
      hint: '[#N] type: subject',
    });
  });

  test('a half-written block is filled in: agent alone, or message alone', () => {
    expect(
      VULCAN_CONFIG_SCHEMA.parse({ commit: { message: { agent: { signature: 'deny' } } } }).commit
        .message.agent,
    ).toEqual({ signature: 'deny', names: [], allow: [] });
    expect(VULCAN_CONFIG_SCHEMA.parse({ commit: {} }).commit.message.agent.signature).toBe('allow');
  });

  test('an unknown key, a flat key, an empty name and a pattern that is not a regular expression are refused', () => {
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ commit: { message: { sign: true } } }).success).toBe(
      false,
    );
    expect(
      VULCAN_CONFIG_SCHEMA.safeParse({ commitMessage: { agentSignature: 'deny' } }).success,
    ).toBe(false);
    expect(
      VULCAN_CONFIG_SCHEMA.safeParse({ commit: { message: { agent: { names: [''] } } } }).success,
    ).toBe(false);
    expect(
      VULCAN_CONFIG_SCHEMA.safeParse({ commit: { message: { agent: { signature: true } } } })
        .success,
    ).toBe(false);

    const unknownValue = VULCAN_CONFIG_SCHEMA.safeParse({
      commit: { message: { agent: { signature: 'maybe' } } },
    });

    expect(unknownValue.success).toBe(false);
    expect(JSON.stringify(unknownValue.error?.issues)).toContain('allow, deny');

    for (const entry of ['-', '  ', '', '...']) {
      for (const key of ['names', 'allow']) {
        expect(
          VULCAN_CONFIG_SCHEMA.safeParse({ commit: { message: { agent: { [key]: [entry] } } } })
            .success,
          `${key} ${JSON.stringify(entry)}`,
        ).toBe(false);
      }
    }

    const bad = VULCAN_CONFIG_SCHEMA.safeParse({
      commit: { message: { subject: { pattern: '(' } } },
    });

    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toContain('regular expression');
  });
});

describe('the manifest carries commit only when a check is on', () => {
  const root = createProject({ files: {} });

  test('a project that sets nothing gets no block', () => {
    expect(manifestOf({ root, config: {} }).commit).toBeUndefined();
    expect(
      manifestOf({ root, config: { commit: { message: { agent: { signature: 'allow' } } } } })
        .commit,
    ).toBeUndefined();
  });

  test('deny alone is one key', () => {
    expect(
      manifestOf({ root, config: { commit: { message: { agent: { signature: 'deny' } } } } })
        .commit,
    ).toEqual({ message: { agent: { signature: 'deny' } } });
  });

  test('extra agent names and the subject shape are written when set', () => {
    const subject = { pattern: '^x', hint: 'x' };

    expect(
      manifestOf({
        root,
        config: {
          commit: { message: { agent: { signature: 'deny', names: ['windsurf'] }, subject } },
        },
      }).commit,
    ).toEqual({ message: { agent: { signature: 'deny', names: ['windsurf'] }, subject } });
  });

  test('allowed names are written with the signature check', () => {
    expect(
      manifestOf({
        root,
        config: {
          commit: { message: { agent: { signature: 'deny', allow: ['Claude Dupont'] } } },
        },
      }).commit,
    ).toEqual({ message: { agent: { signature: 'deny', allow: ['Claude Dupont'] } } });
  });

  test('names are not written while the signature check is off', () => {
    expect(
      manifestOf({
        root,
        config: {
          commit: { message: { agent: { names: ['windsurf'] }, subject: { pattern: '^x' } } },
        },
      }).commit,
    ).toEqual({ message: { agent: { signature: 'allow' }, subject: { pattern: '^x' } } });
  });
});

describe('CommitPolicy.read', () => {
  test('no manifest, or a manifest without the block, means nothing is configured', () => {
    expect(CommitPolicy.read({ root: createProject({ files: {} }) })).toBeUndefined();
    expect(
      CommitPolicy.read({ root: projectWithManifest({ manifest: { name: 'x' } }) }),
    ).toBeUndefined();
  });

  test('the block becomes a policy with the shipped agents and the project ones', () => {
    const policy = CommitPolicy.read({
      root: projectWithManifest({
        manifest: {
          commit: {
            message: {
              agent: { signature: 'deny', names: ['windsurf'], allow: ['Claude Dupont'] },
              subject: { pattern: '^x' },
            },
          },
        },
      }),
    });

    expect(policy?.agentSignature).toBe('deny');
    expect(policy?.agents.products).toEqual(expect.arrayContaining(['claude code', 'windsurf']));
    expect(policy?.agents.mentions).toEqual(expect.arrayContaining(['claude', 'windsurf']));
    expect(policy?.agents.allow).toEqual(['Claude Dupont']);
    expect(policy?.subject).toEqual({ pattern: '^x' });
  });

  test('a block that is not what sync writes is ignored, with a note, not a crash', () => {
    const maybe = projectWithManifest({
      manifest: { commit: { message: { agent: { signature: 'maybe' } } } },
    });
    const noAgent = projectWithManifest({ manifest: { commit: { message: {} } } });
    const badAllow = projectWithManifest({
      manifest: { commit: { message: { agent: { signature: 'deny', allow: [1] } } } },
    });
    const emptyAllow = projectWithManifest({
      manifest: { commit: { message: { agent: { signature: 'deny', allow: ['-'] } } } },
    });

    expect(CommitPolicy.read({ root: maybe })).toBeUndefined();
    expect(CommitPolicy.read({ root: noAgent })).toBeUndefined();
    expect(CommitPolicy.read({ root: badAllow })).toBeUndefined();
    expect(CommitPolicy.read({ root: emptyAllow })).toBeUndefined();
  });

  test('a manifest that is not JSON is ignored', () => {
    const root = createProject({ files: { '.agents/vulcan.manifest.json': '{ nope' } });

    expect(CommitPolicy.read({ root })).toBeUndefined();
  });
});
