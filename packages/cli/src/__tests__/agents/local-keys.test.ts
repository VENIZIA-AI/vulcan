import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL_AGENTS_FILE, LocalChoice } from '../../agents/index.ts';
import { OwnerProfile } from '../../owner/index.ts';
import { LocalSettings } from '../../common/local-settings.ts';
import { BoardSettings } from '../../board/settings.ts';
import { ProjectContract } from '../../doctor/checks.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { ProjectTmp } from '../../hooks/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const MANIFEST = '.agents/local/vulcan.manifest.json';
const ROSTER = { aurora: { shape: 'flame', role: 'Frontend' } };
const CONFIG =
  "export default { project: { name: 'acme' }, agent: { rules: { 'V-W-01': 'read-only' } } };\n";

const projectWith = (opts: {
  local?: unknown;
  manifest?: object;
  files?: Record<string, string>;
}) => {
  const root = createProject({
    files: {
      '.configs/vulcan.config.mts': CONFIG,
      'AGENTS.md': '# x\n',
      [MANIFEST]: JSON.stringify(opts.manifest ?? { schemaVersion: 1 }),
      ...(opts.local === undefined
        ? {}
        : { [LOCAL_AGENTS_FILE]: JSON.stringify({ schemaVersion: 1, ...(opts.local as object) }) }),
      ...opts.files,
    },
  });

  return root;
};

const git = (root: string, ...args: string[]) =>
  Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });

describe('the local file reads board.agents and local.tmp', () => {
  test('a file with only the two keys is valid and chooses no agents', () => {
    const root = projectWith({
      local: { board: { page: { agents: ROSTER } }, common: { local: { tmp: 't' } } },
    });

    expect(LocalChoice.read({ root })).toEqual({ ok: true, agents: undefined });
    expect(LocalSettings.read({ root })).toEqual({ tmp: 't', boardAgents: ROSTER });
  });

  test('a value that cannot be used is named by file and key, and the hooks leave it out', () => {
    const cases: [object, RegExp, object][] = [
      [{ common: { local: { tmp: '../out' } } }, /profile\.json: common\.local\.tmp/, {}],
      [{ common: { local: { tmp: 't', extra: 1 } } }, /profile\.json: common\.local/, { tmp: 't' }],
      [{ board: { page: { agents: { a: 'nope' } } } }, /profile\.json: board\.page\.agents\.a/, {}],
      [
        { board: { page: { agents: { a: { lane: 'b' } } } } },
        /profile\.json: board\.page\.agents\.a\.lane/,
        { boardAgents: { a: { lane: 'b' } } },
      ],
    ];

    for (const [local, error, used] of cases) {
      const root = projectWith({ local });
      const read = LocalChoice.read({ root });

      expect(read.ok).toBe(false);
      expect(read.ok ? '' : read.error).toMatch(error);
      // A hook never throws: a bad folder is not used, a roster is handed on and the board says why.
      expect(() => LocalSettings.read({ root })).not.toThrow();
      expect(LocalSettings.read({ root }).tmp).toBe((used as { tmp?: string }).tmp);
    }
  });

  test('a file that is not JSON gives nothing to the hooks', () => {
    const root = projectWith({ files: { [LOCAL_AGENTS_FILE]: '{ nope' } });

    expect(LocalSettings.read({ root })).toEqual({});
  });

  test('an unknown top-level key is reported by doctor (the profile is strict) and does not stop the choice', () => {
    const root = projectWith({ local: { agent: { list: ['claude'] }, boards: {} } });
    const profile = OwnerProfile.read({ root });

    expect(LocalChoice.read({ root })).toEqual({ ok: true, agents: ['claude'] });
    expect(profile.ok).toBe(false);
    expect(profile.ok ? '' : profile.error).toContain('boards');

    const messages = ProjectContract.checkProfile({
      root,
      config: VULCAN_CONFIG_SCHEMA.parse({}),
      configFile: '.configs/vulcan.config.mts',
    }).map((violation) => violation.message);

    expect(messages.join('\n')).toContain('boards');
  });
});

describe('precedence: the local value replaces the whole key', () => {
  test('local.tmp: the local folder, else the manifest, else the default', () => {
    const own = projectWith({
      manifest: { schemaVersion: 1, local: { tmp: 'team' } },
      local: { common: { local: { tmp: 'mine' } } },
    });
    const team = projectWith({ manifest: { schemaVersion: 1, local: { tmp: 'team' } } });
    const none = projectWith({});

    expect(ProjectTmp.relativeOf({ root: own })).toBe('mine');
    expect(ProjectTmp.projectOf({ root: own })).toBe(join(own, 'mine'));
    expect(ProjectTmp.relativeOf({ root: team })).toBe('team');
    expect(ProjectTmp.relativeOf({ root: none })).toBe('.agents/tmp');
    expect(ProjectTmp.effectiveOf({ root: own, tmp: 'team' })).toBe('mine');
    expect(ProjectTmp.effectiveOf({ root: team, tmp: 'team' })).toBe('team');
  });

  test('a local folder that is not a layout folder falls back to the manifest', () => {
    const root = projectWith({
      manifest: { schemaVersion: 1, local: { tmp: 'team' } },
      local: { common: { local: { tmp: '../out' } } },
    });

    expect(ProjectTmp.relativeOf({ root })).toBe('team');
  });

  test('board.agents: the local roster replaces the committed one, not merged with it', () => {
    const manifest = { name: 'Acme', board: { agents: { umbra: 'ember', aurora: 'bun' } } };
    const own = BoardSettings.read({
      root: projectWith({ manifest, local: { board: { page: { agents: ROSTER } } } }),
    });
    const team = BoardSettings.read({ root: projectWith({ manifest }) });

    expect(own.roster).toEqual(['aurora']);
    expect(own.shapes).toEqual({ aurora: 'flame' });
    expect(own.roles).toEqual({ aurora: 'Frontend' });
    expect(team.roster).toEqual(['umbra', 'aurora']);
  });

  test('a broken local roster keeps the committed one, and the board names the file', () => {
    const manifest = { name: 'Acme', board: { agents: { umbra: 'ember' } } };

    for (const agents of [{ a: { lane: 'a' } }, { a: 'nope' }]) {
      const settings = BoardSettings.read({
        root: projectWith({ manifest, local: { board: { page: { agents } } } }),
      });

      expect(settings.roster).toEqual(['umbra']);
      expect(settings.shapes).toEqual({ umbra: 'ember' });
      expect(settings.notes.join('\n')).toContain(
        'board.page.agents in .agents/local/profile.json is not used',
      );
    }
  });
});

describe('vulcan project sync with a local file', () => {
  const sync = (root: string, agents = 'claude') =>
    runCli({ args: ['project', 'sync', '--agents', agents], cwd: root });

  test('keeps board and local when it writes the agents, and writes nothing else of them', () => {
    const root = projectWith({
      local: { board: { page: { agents: ROSTER } }, common: { local: { tmp: 't' } } },
    });
    const result = sync(root);
    const after = JSON.parse(readFileSync(join(root, LOCAL_AGENTS_FILE), 'utf8'));

    expect(result.code).toBe(0);
    expect(after.agent.list).toEqual(['claude']);
    expect(after.board).toEqual({ page: { agents: ROSTER } });
    expect(after.common).toEqual({ local: { tmp: 't' } });
    expect(LocalChoice.render({ agents: ['omp'], previous: 'not json' })).toContain('"omp"');
  });

  test('a local tmp is made, and its ignore line is in .git/info/exclude, never in .gitignore', () => {
    const root = projectWith({
      local: { common: { local: { tmp: 't' } } },
      files: { '.gitignore': 'node_modules/\n' },
    });

    git(root, 'init', '-q');
    expect(sync(root).code).toBe(0);
    expect(readFileSync(join(root, '.git/info/exclude'), 'utf8')).toContain('/t/');
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).not.toContain('/t/');
    expect(statSync(join(root, 't')).isDirectory()).toBe(true);
    expect(git(root, 'check-ignore', '-q', 't/x').exitCode).toBe(0);
  });

  test('a broken local value stops sync and writes nothing', () => {
    const root = projectWith({ local: { common: { local: { tmp: '../out' } } } });
    const before = readFileSync(join(root, MANIFEST), 'utf8');
    const result = sync(root);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('local.tmp');
    expect(readFileSync(join(root, MANIFEST), 'utf8')).toBe(before);
    expect(existsSync(join(root, '.agents/local/claude.launch.settings.json'))).toBe(false);
    expect(existsSync(join(root, '..t')) || existsSync(join(root, '../out'))).toBe(false);
  });

  test('the manifest, AGENTS.md and .gitignore are the same with and without a local file', () => {
    const team = {
      '.configs/vulcan.config.mts':
        "export default { project: { name: 'acme' }, board: { page: { agents: { umbra: 'ember' } } }, common: { local: { tmp: 'tmp' } } };\n",
      '.gitignore': 'node_modules/\n',
    };
    const plain = projectWith({ files: team });
    const own = projectWith({
      files: team,
      local: { board: { page: { agents: ROSTER } }, common: { local: { tmp: 't' } } },
    });

    for (const root of [plain, own]) {
      mkdirSync(join(root, '.agents'), { recursive: true });
      expect(sync(root).code).toBe(0);
    }

    for (const file of [MANIFEST, 'AGENTS.md', '.gitignore']) {
      expect(readFileSync(join(own, file), 'utf8')).toBe(readFileSync(join(plain, file), 'utf8'));
    }

    expect(readFileSync(join(own, '.gitignore'), 'utf8')).toContain('/tmp/');
    expect(statSync(join(own, 't')).isDirectory()).toBe(true);
  });
});

describe('vulcan project doctor', () => {
  test('names the file and the key of a broken local value', () => {
    const root = projectWith({ local: { common: { local: { tmp: '../out' } } } });
    const result = runCli({ args: ['project', 'doctor'], cwd: root });

    expect(result.stderr + result.stdout).toContain('local.tmp');
    expect(result.stderr + result.stdout).toContain(LOCAL_AGENTS_FILE);
  });

  test('a problem of a tmp folder from the local file is reported against that file', () => {
    const root = projectWith({ local: { common: { local: { tmp: 'shared' } } } });
    const violations = ProjectContract.checkTmpFolder({
      root,
      config: VULCAN_CONFIG_SCHEMA.parse({ layout: { shared: 'shared' } }),
      configFile: '.configs/vulcan.config.mts',
    });

    expect(violations.length).toBeGreaterThan(0);
    expect(violations.every((violation) => violation.file === LOCAL_AGENTS_FILE)).toBe(true);
  });
});
