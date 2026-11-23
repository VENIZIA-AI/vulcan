import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL_AGENTS_FILE, LocalChoice } from '../../agents/index.ts';
import { LocalSettings } from '../../common/local-settings.ts';
import { BoardSettings } from '../../board/settings.ts';
import { ProjectContract } from '../../doctor/checks.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { ProjectTmp } from '../../hooks/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const MANIFEST = '.agents/vulcan.manifest.json';
const ROSTER = { aurora: { shape: 'flame', role: 'Frontend' } };
const CONFIG = "export default { name: 'acme', rules: { 'V-W-01': 'read-only' } };\n";

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
    const root = projectWith({ local: { board: { agents: ROSTER }, local: { tmp: 't' } } });

    expect(LocalChoice.read({ root })).toEqual({ ok: true, agents: undefined });
    expect(LocalSettings.read({ root })).toEqual({ tmp: 't', agents: ROSTER });
  });

  test('a value that cannot be used is named by file and key, and the hooks leave it out', () => {
    const cases: [object, RegExp, object][] = [
      [{ local: { tmp: '../out' } }, /vulcan\.local\.json: local\.tmp/, {}],
      [{ local: { tmp: 't', extra: 1 } }, /vulcan\.local\.json: local/, { tmp: 't' }],
      [{ board: { agents: { a: 'nope' } } }, /vulcan\.local\.json: board\.agents\.a/, {}],
      [
        { board: { agents: { a: { lane: 'b' } } } },
        /vulcan\.local\.json: board\.agents\.a\.lane/,
        { agents: { a: { lane: 'b' } } },
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

  test('an unknown top-level key is reported by doctor and does not stop the file', () => {
    const root = projectWith({ local: { agents: ['claude'], boards: {} } });

    expect(LocalChoice.read({ root })).toEqual({ ok: true, agents: ['claude'] });
    expect(LocalChoice.unknownKeys({ root })).toEqual(['boards']);

    const messages = ProjectContract.checkAgents({
      root,
      config: VULCAN_CONFIG_SCHEMA.parse({}),
      configFile: '.configs/vulcan.config.mts',
    }).map((violation) => violation.message);

    expect(messages.join('\n')).toContain("unknown key 'boards'");
  });
});

describe('precedence: the local value replaces the whole key', () => {
  test('local.tmp: the local folder, else the manifest, else the default', () => {
    const own = projectWith({
      manifest: { schemaVersion: 1, local: { tmp: 'team' } },
      local: { local: { tmp: 'mine' } },
    });
    const team = projectWith({ manifest: { schemaVersion: 1, local: { tmp: 'team' } } });
    const none = projectWith({});

    expect(ProjectTmp.relativeOf({ root: own })).toBe('mine');
    expect(ProjectTmp.projectOf({ root: own })).toBe(join(own, 'mine'));
    expect(ProjectTmp.relativeOf({ root: team })).toBe('team');
    expect(ProjectTmp.relativeOf({ root: none })).toBe('.agents/local/tmp');
    expect(ProjectTmp.effectiveOf({ root: own, tmp: 'team' })).toBe('mine');
    expect(ProjectTmp.effectiveOf({ root: team, tmp: 'team' })).toBe('team');
  });

  test('a local folder that is not a layout folder falls back to the manifest', () => {
    const root = projectWith({
      manifest: { schemaVersion: 1, local: { tmp: 'team' } },
      local: { local: { tmp: '../out' } },
    });

    expect(ProjectTmp.relativeOf({ root })).toBe('team');
  });

  test('board.agents: the local roster replaces the committed one, not merged with it', () => {
    const manifest = { name: 'Acme', board: { agents: { umbra: 'ember', aurora: 'bun' } } };
    const own = BoardSettings.read({
      root: projectWith({ manifest, local: { board: { agents: ROSTER } } }),
    });
    const team = BoardSettings.read({ root: projectWith({ manifest }) });

    expect(own.roster).toEqual(['aurora']);
    expect(own.shapes).toEqual({ aurora: 'flame' });
    expect(own.roles).toEqual({ aurora: 'Frontend' });
    expect(team.roster).toEqual(['umbra', 'aurora']);
  });

  test('a roster with a bad entry is not used and the board says why', () => {
    const root = projectWith({
      manifest: { name: 'Acme', board: { agents: { umbra: 'ember' } } },
      local: { board: { agents: { a: { lane: 'a' } } } },
    });

    expect(BoardSettings.read({ root }).notes.join('\n')).toContain(
      'board.agents in .agents/vulcan.local.json is not used',
    );
  });
});

describe('vulcan sync with a local file', () => {
  const sync = (root: string, agents = 'claude') =>
    runCli({ args: ['sync', '--agents', agents], cwd: root });

  test('keeps board and local when it writes the agents, and writes nothing else of them', () => {
    const root = projectWith({ local: { board: { agents: ROSTER }, local: { tmp: 't' } } });
    const result = sync(root);
    const after = JSON.parse(readFileSync(join(root, LOCAL_AGENTS_FILE), 'utf8'));

    expect(result.code).toBe(0);
    expect(after.agents).toEqual(['claude']);
    expect(after.board).toEqual({ agents: ROSTER });
    expect(after.local).toEqual({ tmp: 't' });
    expect(LocalChoice.render({ agents: ['omp'], previous: 'not json' })).toContain('"omp"');
  });

  test('a local tmp is made, and its ignore line is in .git/info/exclude, never in .gitignore', () => {
    const root = projectWith({
      local: { local: { tmp: 't' } },
      files: { '.gitignore': 'node_modules/\n' },
    });

    git(root, 'init', '-q');
    expect(sync(root).code).toBe(0);
    expect(readFileSync(join(root, '.git/info/exclude'), 'utf8')).toContain('/t/');
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).not.toContain('/t/');
    expect(Bun.file(join(root, 't')).size).toBeDefined();
    expect(git(root, 'check-ignore', '-q', 't/x').exitCode).toBe(0);
  });

  test('a broken local value stops sync and writes nothing', () => {
    const root = projectWith({ local: { local: { tmp: '../out' } } });
    const result = sync(root);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('local.tmp');
  });

  test('the manifest and AGENTS.md are the same with and without a local file', () => {
    const plain = projectWith({});
    const own = projectWith({ local: { board: { agents: ROSTER }, local: { tmp: 't' } } });

    for (const root of [plain, own]) {
      mkdirSync(join(root, '.agents'), { recursive: true });
      expect(sync(root).code).toBe(0);
    }

    for (const file of [MANIFEST, 'AGENTS.md']) {
      expect(readFileSync(join(own, file), 'utf8')).toBe(readFileSync(join(plain, file), 'utf8'));
    }
  });
});

describe('vulcan doctor', () => {
  test('names the file and the key of a broken local value', () => {
    const root = projectWith({ local: { local: { tmp: '../out' } } });
    const result = runCli({ args: ['doctor'], cwd: root });

    expect(result.stderr + result.stdout).toContain('local.tmp');
    expect(result.stderr + result.stdout).toContain(LOCAL_AGENTS_FILE);
  });
});
