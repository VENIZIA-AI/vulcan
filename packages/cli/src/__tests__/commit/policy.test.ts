import { afterAll, describe, expect, test, afterEach, beforeEach } from 'bun:test';
import { VulcanConfigSchema } from '../../config/index.ts';
import { AgentSignaturePolicies, CommitPolicy } from '../../commit/index.ts';
import { ProjectManifest } from '../../manifest/index.ts';
import { createProject, removeProjects } from '../helpers/project.helper.ts';
import { CapturedStderr } from '../helpers/stderr.helper.ts';

let stderr: CapturedStderr;

beforeEach(() => {
  stderr = CapturedStderr.start();
});

afterAll(removeProjects);

const manifestOf = (opts: { root: string; config: object }): Record<string, unknown> =>
  JSON.parse(
    ProjectManifest.render({ root: opts.root, config: VulcanConfigSchema.parse(opts.config) }),
  );

const projectWithManifest = (opts: { manifest: object }): string =>
  createProject({ files: { '.agents/local/vulcan.manifest.json': JSON.stringify(opts.manifest) } });

/** Registered last: it fails on an unclaimed line, and a failing hook skips the hooks after it. */
afterEach(() => {
  stderr.restore();
});

describe('AgentSignaturePolicies', () => {
  test('two values, and isValid reads them', () => {
    expect(AgentSignaturePolicies.values()).toEqual(['allow', 'deny']);
    expect(AgentSignaturePolicies.isValid('deny')).toBe(true);
    expect(AgentSignaturePolicies.isValid('maybe')).toBe(false);
  });
});

describe('commit.message in the config', () => {
  test('every check is off until the project turns it on', () => {
    expect(VulcanConfigSchema.parse({}).commit).toEqual({
      message: { agent: { signature: 'allow', names: [], allow: [] } },
    });
  });

  test('agent.signature, agent.names and a subject shape are accepted', () => {
    const parsed = VulcanConfigSchema.parse({
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
      VulcanConfigSchema.parse({ commit: { message: { agent: { signature: 'deny' } } } }).commit
        .message.agent,
    ).toEqual({ signature: 'deny', names: [], allow: [] });
    expect(VulcanConfigSchema.parse({ commit: {} }).commit.message.agent.signature).toBe('allow');
  });

  test('an unknown key, a flat key, an empty name and a pattern that is not a regular expression are refused', () => {
    expect(VulcanConfigSchema.safeParse({ commit: { message: { sign: true } } }).success).toBe(
      false,
    );
    expect(
      VulcanConfigSchema.safeParse({ commitMessage: { agentSignature: 'deny' } }).success,
    ).toBe(false);
    expect(
      VulcanConfigSchema.safeParse({ commit: { message: { agent: { names: [''] } } } }).success,
    ).toBe(false);
    expect(
      VulcanConfigSchema.safeParse({ commit: { message: { agent: { signature: true } } } }).success,
    ).toBe(false);

    const unknownValue = VulcanConfigSchema.safeParse({
      commit: { message: { agent: { signature: 'maybe' } } },
    });

    expect(unknownValue.success).toBe(false);
    expect(JSON.stringify(unknownValue.error?.issues)).toContain('allow, deny');

    for (const entry of ['-', '  ', '', '...']) {
      for (const key of ['names', 'allow']) {
        expect(
          VulcanConfigSchema.safeParse({ commit: { message: { agent: { [key]: [entry] } } } })
            .success,
          `${key} ${JSON.stringify(entry)}`,
        ).toBe(false);
      }
    }

    const bad = VulcanConfigSchema.safeParse({
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

describe('CommitPolicy.read in a clone that did not sync', () => {
  test('a config and no local manifest refuse agent signatures; no config changes nothing; the earlier manifest is not read', () => {
    const unsynced = createProject({
      files: { '.configs/vulcan.config.mts': 'export default {};\n' },
    });
    const legacyOnly = createProject({
      files: {
        '.configs/vulcan.config.mts': 'export default {};\n',
        '.agents/vulcan.manifest.json': JSON.stringify({
          commit: { message: { agent: { signature: 'allow' } } },
        }),
      },
    });

    expect(CommitPolicy.read({ root: unsynced })?.agentSignature).toBe('deny');
    expect(CommitPolicy.read({ root: legacyOnly })?.agentSignature).toBe('deny');
    expect(CommitPolicy.read({ root: createProject({ files: {} }) })).toBeUndefined();

    stderr.claim({
      parts: [
        '[CommitPolicy.read] .agents/local/vulcan.manifest.json is missing: agent signatures are refused until you run vulcan project sync',
      ],
      times: 2,
    });
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

    stderr.claim({
      parts: [
        '[CommitPolicy.read] ignoring check.commit.message in .agents/local/vulcan.manifest.json: not the shape vulcan project sync writes',
      ],
      times: 4,
    });
  });

  test('a manifest that is not JSON is ignored', () => {
    const root = createProject({ files: { '.agents/local/vulcan.manifest.json': '{ nope' } });

    expect(CommitPolicy.read({ root })).toBeUndefined();

    stderr.claim({
      parts: [
        '[CommitPolicy.read] .agents/local/vulcan.manifest.json is not JSON | JSON Parse error',
      ],
    });
  });
});
