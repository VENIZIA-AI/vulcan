import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ConfigGroups, VulcanConfigSchema } from '../../config/index.ts';
import type { TVulcanConfigInput, TVulcanConfigOutput } from '../../index.ts';
import { FROZEN_CONFIG_SCHEMA } from './frozen-schema.helper.ts';

/** True only when the two types are identical, optional against `| undefined` included. */
type TIsEqual<Left, Right> =
  (<Probe>() => Probe extends Left ? 1 : 2) extends <Probe>() => Probe extends Right ? 1 : 2
    ? true
    : false;

const INPUT_UNCHANGED: TIsEqual<TVulcanConfigInput, z.input<typeof FROZEN_CONFIG_SCHEMA>> = true;
const OUTPUT_UNCHANGED: TIsEqual<TVulcanConfigOutput, z.output<typeof FROZEN_CONFIG_SCHEMA>> = true;

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..', '..');
const BASE = join(import.meta.dir, '..', '..', '..', 'base');

const readJson = (opts: { path: string }): unknown => JSON.parse(readFileSync(opts.path, 'utf8'));

const flatOf = (opts: { path: string }): unknown =>
  ConfigGroups.toFlat({ value: readJson({ path: opts.path }) as Record<string, unknown> }).flat;

const projectConfig = await import(join(REPO_ROOT, '.configs', 'vulcan.config.mts'));

/** Configs that parse: every section set at least once. */
const VALID: Record<string, unknown> = {
  empty: {},
  // This repository's config is written in groups; the frozen schema is the flat one.
  'this repository': ConfigGroups.toFlat({ value: projectConfig.default }).flat,
  // The shipped files are written in groups; the frozen schema is the flat one.
  'shipped defaults': flatOf({ path: join(BASE, 'defaults.config.json') }),
  'venizia pack': flatOf({ path: join(BASE, 'packs', 'venizia.config.json') }),
  'every section': {
    name: 'demo',
    project: { key: 'DEMO' },
    agents: ['claude', 'omp'],
    rules: { 'V-W-01': 'read-only' },
    packs: ['venizia'],
    remove: { 'atlas.sources': ['ignis'] },
    layout: { backend: 'apps/backends', frontend: ['apps/web', 'apps/admin'], other: 'docs' },
    presets: [{ spec: 'ignis', side: 'backend', summary: 'an app', lib: 'a lib' }],
    packages: [
      { dir: 'core', name: '@demo/core' },
      { dir: 'old', name: 'demo-old', path: 'legacy/old', retired: true, aliases: ['legacy'] },
      { dir: 'kit', name: '@demo/kit', type: 'lib', presetType: 'shared' },
    ],
    knowledge: {
      wiki: 'docs/wiki',
      changelogs: 'docs/changelogs',
      migrationFrom: '0.4.5',
      codemodCommand: ['devz', 'codemod'],
      datedUntil: '2026-11-14',
      siteUrl: 'https://wiki.example.com/',
    },
    okf: {
      renderers: ['packages', { id: 'custom', module: './renderer.ts' }],
      regions: [{ id: 'r', file: 'README.md', renderer: 'packages' }],
      coverage: [{ name: 'src', path: 'packages/*/src', exclude: ['**/dist'] }],
      denylist: ['fixtures'],
      contents: { files: ['AGENTS.md'] },
      brand: 'DEMO',
    },
    atlas: {
      tagPattern: '<dir>@<version>',
      legacyTagPatterns: ['v<version>'],
      sources: [{ name: 'ignis', repo: 'VENIZIA-AI/ignis', pin: 'ref' }],
      ignoreTags: ['old-*'],
      index: { keys: [Buffer.alloc(32, 7).toString('base64')] },
      prebuilt: false,
      limits: { download: 2 * 1024 * 1024 },
    },
    theme: { preset: 'slate', accent: '#8a5a20', accentDark: '#dead6a', radius: '4px' },
    board: {
      owner: 'Owner',
      title: 'Demo Board',
      hostname: 'demo.localhost',
      logo: 'assets/logo.svg',
      agents: { helper: 'flame' },
    },
    provider: { type: 'gitlab', host: 'gitlab.example.com:8443' },
    doctor: {
      privateValues: { acknowledged: [{ path: 'fixtures/**', types: ['ipv4'], reason: 'tests' }] },
      layout: { maxLines: 500, pluralAllow: ['status'] },
    },
    claude: { settings: { env: { DEMO: '1' }, permissions: { allow: ['Bash(ls)'] } } },
    digest: { oftenDropped: ['V-C-02'] },
    owner: { language: 'en', report: { enforce: 'block', headlineMaxSentences: 3 } },
    guard: {
      toolOwnedPaths: ['~/.cache/demo/**'],
      outside: 'deny',
      asks: 'deny',
      writes: { commands: [{ rule: 'V-W-02', what: 'migrate', pattern: 'db:migrate' }] },
      git: { askPush: ['release/*'] },
      runners: { allow: ['shadcn'] },
    },
    commit: {
      message: {
        agent: { signature: 'deny', names: ['bot'], allow: ['Bot Person'] },
        subject: { pattern: '^\\[#\\d+\\] ', hint: 'start with [#N]' },
      },
    },
    events: { log: true, maxSize: '50MB', maxFiles: 3, maxAgeDays: 7 },
    local: { autoClean: false, tmp: 't' },
  },
};

/** Configs that fail: each one breaks one refinement, so the issues (paths, codes, messages) are compared too. */
const INVALID: Record<string, unknown> = {
  'unknown key': { typo: true },
  name: { name: 'Bad Name' },
  'project key': { project: { key: 'x' } },
  agents: { agents: ['vim'] },
  rules: { rules: { 'not-a-rule': 'x' } },
  packs: { packs: ['nope'] },
  remove: { remove: { nope: ['x'] } },
  'layout climbing': { layout: { backend: '../apps' } },
  'layout overlap': { layout: { backend: 'apps', frontend: 'apps' } },
  'presets side': { presets: [{ spec: 'x', side: 'middle', summary: 's' }] },
  'packages repeated': {
    packages: [
      { dir: 'core', name: '@a/core' },
      { dir: 'core', name: '@a/core' },
    ],
  },
  'packages npm name': { packages: [{ dir: 'core', name: 'Not A Name' }] },
  'knowledge siteUrl': { knowledge: { siteUrl: 'http://wiki.example.com' } },
  'knowledge migrationFrom': { knowledge: { migrationFrom: 'soon' } },
  'okf removed key': { okf: { viz: {}, sections: [] } },
  'atlas transport': { atlas: { sources: [{ name: 'x', repo: 'http://example.com/x.git' }] } },
  'atlas option-like ref': {
    atlas: { sources: [{ name: 'x', repo: '-x', ref: '--upload-pack' }] },
  },
  'atlas template': { atlas: { tagPattern: 'v<ver>' } },
  'atlas key': { atlas: { index: { keys: ['abc'] } } },
  'atlas download': { atlas: { limits: { download: 1 } } },
  'theme accent': { theme: { accent: 'blue' } },
  'theme preset': { theme: { preset: 'neon' } },
  'theme tokens': { theme: { tokens: { nope: '#000000' } } },
  'board hostname': { board: { hostname: 'board.example.com' } },
  'board logo': { board: { logo: '/abs/logo.svg' } },
  'provider host': { provider: { type: 'github', host: 'gitlab.example.com' } },
  'doctor path': { doctor: { privateValues: { acknowledged: [{ path: '../x', reason: 'r' }] } } },
  'doctor layout': { doctor: { layout: { maxLines: 0 } } },
  'claude env': {
    claude: { settings: { env: { VULCAN_GUARD_ASKS: 'ask', BUN_OPTIONS: '-r x' } } },
  },
  digest: { digest: { oftenDropped: ['nope'] } },
  'owner shape': { owner: { report: { shape: [] } } },
  'owner removed key': { owner: { report: { claimWords: ['done'] } } },
  'owner language': { owner: { language: 'english!' } },
  'guard pattern': {
    guard: { writes: { commands: [{ rule: 'V-W-03', what: 'deploy', pattern: '(' }] } },
  },
  'guard removed key': { guard: { writes: { trustedScripts: ['x'] } } },
  'guard push target': { guard: { git: { askPush: ['a b'] } } },
  'guard runners': { guard: { runners: { allow: ['Bad Name'] } } },
  'commit signature': { commit: { message: { agent: { signature: 'maybe' } } } },
  'commit names': { commit: { message: { agent: { names: ['---'] } } } },
  'commit subject': { commit: { message: { subject: { pattern: '(' } } } },
  'events dir': { events: { dir: 'relative/dir' } },
  'events size': { events: { maxSize: 'big' } },
  'local tmp': { local: { tmp: '/abs' } },
};

const viewOf = (opts: { schema: z.ZodType; value: unknown }): string => {
  const result = opts.schema.safeParse(opts.value);

  return JSON.stringify(result.success ? { data: result.data } : { issues: result.error.issues });
};

describe('the config schema is pinned to its frozen copy', () => {
  test('TVulcanConfigInput and TVulcanConfigOutput are the frozen input and output types', () => {
    expect([INPUT_UNCHANGED, OUTPUT_UNCHANGED]).toEqual([true, true]);
  });

  test('the top-level keys keep their order', () => {
    expect(Object.keys(VulcanConfigSchema.shape)).toEqual(Object.keys(FROZEN_CONFIG_SCHEMA.shape));
  });

  for (const io of ['input', 'output'] as const) {
    test(`the JSON schema of the ${io} is the frozen one`, () => {
      const options = { io, unrepresentable: 'any' } as const;

      expect(JSON.stringify(z.toJSONSchema(VulcanConfigSchema, options))).toBe(
        JSON.stringify(z.toJSONSchema(FROZEN_CONFIG_SCHEMA, options)),
      );
    });
  }

  for (const [name, value] of Object.entries(VALID)) {
    test(`a valid config parses to the same output: ${name}`, () => {
      expect(VulcanConfigSchema.safeParse(value).success).toBe(true);
      expect(viewOf({ schema: VulcanConfigSchema, value })).toBe(
        viewOf({ schema: FROZEN_CONFIG_SCHEMA, value }),
      );
    });
  }

  for (const [name, value] of Object.entries(INVALID)) {
    test(`an invalid config fails with the same issues: ${name}`, () => {
      expect(VulcanConfigSchema.safeParse(value).success).toBe(false);
      expect(viewOf({ schema: VulcanConfigSchema, value })).toBe(
        viewOf({ schema: FROZEN_CONFIG_SCHEMA, value }),
      );
    });
  }
});
