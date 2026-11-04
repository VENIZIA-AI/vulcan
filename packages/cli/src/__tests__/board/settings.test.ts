import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { BoardSettings } from '../../board/settings.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { ProjectManifest } from '../../manifest/index.ts';
import { git } from '../git-repo.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { hermeticEnv } from '../hermetic.helper.ts';

afterAll(removeProjects);

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
const parse = (board: unknown) => VULCAN_CONFIG_SCHEMA.safeParse({ board });

describe('board in the config', () => {
  test('nothing is set by default', () => {
    expect(VULCAN_CONFIG_SCHEMA.parse({}).board).toEqual({ agents: {} });
  });

  test('an owner, a title, a logo path and agent faces are accepted', () => {
    const parsed = parse({
      owner: 'Ana',
      title: 'Acme Board',
      logo: '.configs/logo.svg',
      agents: { 'pnt-api-1': 'flame', helper: 'bun' },
    });

    expect(parsed.success).toBe(true);
  });

  test('a logo that is not an svg, is absolute or climbs out, an unknown face and an unknown key are refused', () => {
    expect(parse({ logo: 'logo.png' }).success).toBe(false);
    expect(parse({ logo: '/etc/logo.svg' }).success).toBe(false);
    expect(parse({ logo: '../logo.svg' }).success).toBe(false);
    expect(parse({ logo: 'a/../../logo.svg' }).success).toBe(false);
    expect(parse({ owner: '' }).success).toBe(false);
    expect(parse({ agents: { x: 'dragon' } }).success).toBe(false);
    expect(parse({ colour: 'red' }).success).toBe(false);
  });

  test('the manifest carries board only when something is set, and only what is set', () => {
    const manifestOf = (board: unknown) =>
      JSON.parse(
        ProjectManifest.render({
          root: createProject({ files: {} }),
          config: VULCAN_CONFIG_SCHEMA.parse({ board }),
        }),
      );

    expect(manifestOf(undefined).board).toBeUndefined();
    expect(manifestOf({ agents: {} }).board).toBeUndefined();
    expect(manifestOf({ owner: 'Ana' }).board).toEqual({ owner: 'Ana' });
    expect(manifestOf({ title: 'T', agents: { a: 'rock' } }).board).toEqual({
      title: 'T',
      agents: { a: 'rock' },
    });
  });
});

describe('BoardSettings.resolve', () => {
  const none = (): undefined => undefined;

  test('the project owns the names: owner, title and key from the manifest', () => {
    const settings = BoardSettings.resolve({
      manifest: { name: 'Acme Shop', board: { owner: 'Ana', title: 'Shop floor' } },
      gitUser: 'Someone Else',
      readLogo: none,
    });

    expect(settings).toMatchObject({
      owner: 'Ana',
      title: 'Shop floor',
      key: 'acme-shop',
      shapes: {},
    });
  });

  test('the owner falls back to git user.name, then to Owner; the title to "<project> Board"', () => {
    expect(
      BoardSettings.resolve({ manifest: { name: 'Acme' }, gitUser: 'Ana Git', readLogo: none }),
    ).toMatchObject({
      owner: 'Ana Git',
      title: 'Acme Board',
    });
    expect(
      BoardSettings.resolve({ manifest: { name: 'Acme' }, gitUser: '  ', readLogo: none }).owner,
    ).toBe('Owner');
    expect(
      BoardSettings.resolve({ manifest: { name: 'Acme' }, gitUser: undefined, readLogo: none })
        .owner,
    ).toBe('Owner');
    expect(
      BoardSettings.resolve({ manifest: {}, gitUser: undefined, readLogo: none }),
    ).toMatchObject({ title: 'Project Board', key: 'project' });
  });

  test('no default belongs to any organisation, whatever the manifest is', () => {
    for (const manifest of [
      undefined,
      null,
      'x',
      [],
      {},
      { board: 'x' },
      { board: { owner: 5, title: [] } },
    ]) {
      const settings = BoardSettings.resolve({ manifest, gitUser: undefined, readLogo: none });

      // The address of `board serve` carries the product's own name (VULCAN's default); what the page says does not.
      expect(JSON.stringify({ ...settings, hostname: '' })).not.toMatch(
        /venizia|phát|ignis|ardor/i,
      );
      expect(settings.logo).toBeUndefined();
    }
  });

  test('the key is the project name as a slug', () => {
    expect(
      BoardSettings.resolve({
        manifest: { name: '  @Scope/My App!! ' },
        gitUser: undefined,
        readLogo: none,
      }).key,
    ).toBe('scope-my-app');
  });

  test('only a known face is kept for an agent', () => {
    const settings = BoardSettings.resolve({
      manifest: { board: { agents: { a: 'flame', b: 'dragon', c: 3 } } },
      gitUser: undefined,
      readLogo: none,
    });

    expect(settings.shapes).toEqual({ a: 'flame' });
  });

  test('a logo that cannot be read is no logo, with a note that names it', () => {
    const settings = BoardSettings.resolve({
      manifest: { board: { logo: 'x.svg' } },
      gitUser: undefined,
      readLogo: none,
    });

    expect(settings.logo).toBeUndefined();
    expect(settings.notes[0]).toContain('board.logo x.svg');
  });
});

describe('BoardSettings.read', () => {
  const project = (opts: { manifest: object; files?: Record<string, string> }) =>
    createProject({
      files: { '.agents/vulcan.manifest.json': JSON.stringify(opts.manifest), ...opts.files },
    });

  test('reads the manifest, and an svg of the project as a data URL', () => {
    const root = project({
      manifest: { name: 'Acme', board: { logo: '.configs/logo.svg' } },
      files: { '.configs/logo.svg': SVG },
    });
    const settings = BoardSettings.read({ root });

    expect(settings.logo).toBe(`data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`);
    expect(settings.notes).toEqual([]);
  });

  test('a missing file, a file that is not an svg and one over 100 KB are no logo', () => {
    const cases: Record<string, string>[] = [
      {},
      { 'l.svg': '<html>not a picture</html>' },
      { 'l.svg': `${SVG}${' '.repeat(101 * 1024)}` },
    ];

    for (const files of cases) {
      const settings = BoardSettings.read({
        root: project({ manifest: { board: { logo: 'l.svg' } }, files }),
      });

      expect(settings.logo).toBeUndefined();
      expect(settings.notes).toHaveLength(1);
    }
  });

  test('the owner is git user.name of the project when the manifest has none', () => {
    const root = project({ manifest: { name: 'Acme' } });

    git({ cwd: root, args: ['init', '--quiet'] });
    git({ cwd: root, args: ['config', 'user.name', 'Repo Person'] });

    expect(BoardSettings.read({ root }).owner).toBe('Repo Person');
  });

  test('a manifest that is not JSON is no settings, not a crash', () => {
    const root = createProject({ files: { '.agents/vulcan.manifest.json': '{ nope' } });

    expect(BoardSettings.read({ root })).toMatchObject({ title: 'Project Board' });
  });
});

describe('vulcan board uses the settings', () => {
  test('title, owner, key and faces reach the page data; the logo too', () => {
    const root = createProject({
      files: {
        '.git/HEAD': 'x',
        '.agents/vulcan.manifest.json': JSON.stringify({
          name: 'Acme',
          board: {
            owner: 'Ana',
            title: 'Acme Floor',
            logo: 'logo.svg',
            agents: { 'pnt-api-1': 'flame' },
          },
        }),
        'logo.svg': SVG,
      },
    });
    const result = runCli({ args: ['board', '--no-github'], cwd: root, env: hermeticEnv() });

    expect(result.code, result.stderr).toBe(0);

    const text = readFileSync(result.stdout.trim(), 'utf8');
    const data = JSON.parse(/id="board-data">(.*?)<\/script>/s.exec(text)?.[1] ?? '{}');

    expect(data).toMatchObject({
      title: 'Acme Floor',
      owner: 'Ana',
      key: 'acme',
      shapes: { 'pnt-api-1': 'flame' },
    });
    expect(data.logo).toStartWith('data:image/svg+xml;base64,');
  });
});

describe('board.agents: a face, or { shape?, lane? }', () => {
  const agents = (value: unknown) => parse({ agents: value });
  const messageOf = (result: ReturnType<typeof parse>): string =>
    result.success ? '' : result.error.message;

  test('a face, an object with a shape, a lane, both, or nothing is accepted', () => {
    expect(
      agents({
        umbra: 'ember',
        aurora: { shape: 'flame' },
        etalon: {},
        'pnt-umbra-1': { lane: 'umbra' },
        'pnt-aurora-1': { shape: 'bun', lane: 'aurora' },
      }).success,
    ).toBe(true);
  });

  test('a lane must name a listed key', () => {
    const result = agents({ umbra: 'ember', 'pnt-x-1': { lane: 'nobody' } });

    expect(result.success).toBe(false);
    expect(messageOf(result)).toContain("lane 'nobody' of 'pnt-x-1' is not a key of board.agents");
  });

  test('no chain: a lane cannot itself have a lane', () => {
    const result = agents({ umbra: 'ember', a: { lane: 'umbra' }, b: { lane: 'a' } });

    expect(result.success).toBe(false);
    expect(messageOf(result)).toContain("lane 'a' of 'b' has a lane of its own");
  });

  test('no cycle: two keys that name each other, and a key that names itself', () => {
    expect(messageOf(agents({ a: { lane: 'b' }, b: { lane: 'a' } }))).toContain(
      'has a lane of its own',
    );
    expect(messageOf(agents({ a: 'bun', b: { lane: 'b' } }))).toContain(
      "'b' cannot be its own lane",
    );
  });

  test('a bad face, an empty lane and an unknown key of the object are refused', () => {
    expect(agents({ a: { shape: 'dragon' } }).success).toBe(false);
    expect(agents({ a: 'bun', b: { lane: '' } }).success).toBe(false);
    expect(agents({ a: { colour: 'red' } }).success).toBe(false);
  });

  test('the manifest carries the values as written', () => {
    const board = { agents: { umbra: 'ember', 'pnt-umbra-1': { lane: 'umbra' } } };
    const manifest = JSON.parse(
      ProjectManifest.render({
        root: createProject({ files: {} }),
        config: VULCAN_CONFIG_SCHEMA.parse({ board }),
      }),
    );

    expect(manifest.board).toEqual(board);
  });
});

describe('BoardSettings.resolve: the roster and the lanes', () => {
  const resolve = (agents: unknown) =>
    BoardSettings.resolve({
      manifest: { name: 'Acme', board: { agents } },
      gitUser: undefined,
      readLogo: () => undefined,
    });

  test('nothing listed: no roster, so everyone shows as before', () => {
    expect(resolve({})).toMatchObject({ roster: [], lanes: {}, shapes: {} });
    expect(resolve(undefined)).toMatchObject({ roster: [], lanes: {}, shapes: {} });
  });

  test('the listed keys without a lane are the roster; a lane maps a helper to its lane', () => {
    expect(
      resolve({
        umbra: 'ember',
        aurora: { shape: 'flame' },
        etalon: {},
        'pnt-umbra-1': { lane: 'umbra' },
        'pnt-aurora-1': { shape: 'rock', lane: 'aurora' },
      }),
    ).toMatchObject({
      roster: ['umbra', 'aurora', 'etalon'],
      lanes: { 'pnt-umbra-1': 'umbra', 'pnt-aurora-1': 'aurora' },
      shapes: { umbra: 'ember', aurora: 'flame', 'pnt-aurora-1': 'rock' },
    });
  });

  test('a lane the manifest cannot honour: no agents are used, and one note says why', () => {
    const settings = resolve({ umbra: 'ember', a: { lane: 'nobody' } });

    expect(settings).toMatchObject({ roster: [], lanes: {}, shapes: {} });
    expect(settings.notes).toEqual([
      "board.agents is not used: lane 'nobody' of 'a' is not a key of board.agents",
    ]);
  });

  test('a value that is not a face or an object is skipped; the others are kept', () => {
    expect(resolve({ a: 'flame', b: 'dragon', c: 3, d: { lane: 'a' } })).toMatchObject({
      roster: ['a'],
      lanes: { d: 'a' },
      shapes: { a: 'flame' },
    });
  });
});

describe('BoardSettings.read: the git user', () => {
  test('is the one readGitUser gives, asked once per read, and git is not asked', () => {
    const root = createProject({ files: { '.agents/vulcan.manifest.json': '{}' } });
    let asked = 0;
    const settings = BoardSettings.read({
      root,
      readGitUser: () => {
        asked++;

        return 'Ana From Caller';
      },
    });

    expect(settings.owner).toBe('Ana From Caller');
    expect(asked).toBe(1);
  });
});

describe('board.hostname: the name of the address of board serve', () => {
  const hostnameOf = (hostname: unknown) => VULCAN_CONFIG_SCHEMA.safeParse({ board: { hostname } });

  test.each(['my-board.localhost', 'board.acme.localhost', 'a.localhost', 'a1-b2.c3.localhost'])(
    '%s is accepted',
    (name) => {
      expect(hostnameOf(name).success).toBe(true);
    },
  );

  test.each([
    'example.com',
    'localhost',
    'evil.localhost.com',
    'localhost.evil.com',
    'My-Board.localhost',
    'x.localhost:4000',
    'x.localhost/path',
    'user@x.localhost',
    '-a.localhost',
    'a-.localhost',
    'a_b.localhost',
    'a..localhost',
    '.localhost',
    '',
    5,
  ])('%p is refused', (name) => {
    expect(hostnameOf(name).success).toBe(false);
  });

  test('the manifest carries it only when it is set', () => {
    const manifestOf = (board: unknown) =>
      JSON.parse(
        ProjectManifest.render({
          root: createProject({ files: {} }),
          config: VULCAN_CONFIG_SCHEMA.parse({ board }),
        }),
      );

    expect(manifestOf({ hostname: 'my-board.localhost' }).board).toEqual({
      hostname: 'my-board.localhost',
    });
    expect(manifestOf({ owner: 'Ana' }).board).toEqual({ owner: 'Ana' });
  });

  test('the default when nothing valid is set: the product name; a project name when it is', () => {
    const resolve = (manifest: unknown) =>
      BoardSettings.resolve({ manifest, gitUser: undefined, readLogo: () => undefined }).hostname;

    expect(resolve({})).toBe('vulz-board.venizia.ai.localhost');
    expect(resolve({ board: { hostname: 'my-board.localhost' } })).toBe('my-board.localhost');
    expect(resolve({ board: { hostname: 'example.com' } })).toBe('vulz-board.venizia.ai.localhost');
    expect(resolve({ board: { hostname: 5 } })).toBe('vulz-board.venizia.ai.localhost');
  });
});
