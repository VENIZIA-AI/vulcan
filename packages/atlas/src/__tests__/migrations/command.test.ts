import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MigrateCommand } from '@/migrations';
import { Transport } from '@/protocol';
import { ReleaseStore } from '@/releases';
import { MigrateTool } from '@/tools';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const releases = new ReleaseStore({
  table: {
    livePackages: ['kernel'],
    packageMap: [{ dir: 'kernel', name: '@venizia/kernel', aliases: [] }],
    releases: {
      kernel: [
        { version: '2.0.0', date: '2026-03-01', sha: 'b', order: 2 },
        { version: '1.0.0', date: '2026-01-01', sha: 'a', order: 0 },
      ],
    },
    changelogs: [
      {
        id: 'changelog:2026-02-01-rename',
        file: '2026-02-01-rename.md',
        date: '2026-02-01',
        title: 'Rename',
        packages: ['@venizia/kernel'],
        kind: 'Breaking Change',
        order: 1,
        migration: [
          {
            id: 'rename-thing',
            symbols: ['Thing.make'],
            upgrade: { steps: ['Use ThingFactory.build()'] },
            downgrade: { steps: ['Use Thing.make()'] },
          },
        ],
      },
    ],
  },
});

const transport = new Transport({
  tools: [MigrateTool.build({ releases })],
  serverName: 'test',
  serverVersion: '0',
});

const appDir = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-command-'));

  roots.push(root);
  mkdirSync(join(root, 'src'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ dependencies: { '@venizia/kernel': '1.0.0' } }),
  );
  writeFileSync(
    join(root, 'src', 'a.ts'),
    "import { Thing } from '@venizia/kernel';\n\nThing.make();\n",
  );

  return root;
};

const run = async (opts: { args: string[] }) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await MigrateCommand.run({
    args: opts.args,
    send: (line) => transport.handleLine({ line }),
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  });

  return { code, out: out.join(''), err: err.join('') };
};

describe('MigrateCommand.run', () => {
  test('plan prints Markdown by default and exits 0', async () => {
    const app = appDir();
    const result = await run({
      args: ['plan', '--to', '2.0.0', '--package', '@venizia/kernel', '--app', app],
    });

    expect(result.code).toBe(0);
    expect(result.out).toContain('## @venizia/kernel: 1.0.0 to 2.0.0');
    expect(result.out).toContain('src/a.ts:3 (Thing.make)');
    expect(result.err).toBe('');
  });

  test('C15.1: --format json prints the same JSON the tool answers', async () => {
    const app = appDir();
    const result = await run({
      args: [
        'plan',
        '--to',
        '2.0.0',
        '--package',
        '@venizia/kernel',
        '--app',
        app,
        '--format',
        'json',
      ],
    });
    const direct = await MigrateTool.build({ releases }).call({
      args: { to: '2.0.0', package: '@venizia/kernel', app },
    });

    expect(JSON.parse(result.out)).toEqual(JSON.parse(JSON.stringify(direct)));
  });

  test('a rollback runs through the same door', async () => {
    const app = appDir();
    const result = await run({
      args: [
        'plan',
        '--from',
        '2.0.0',
        '--to',
        '1.0.0',
        '--package',
        '@venizia/kernel',
        '--app',
        app,
      ],
    });

    expect(result.code).toBe(0);
    expect(result.out).toContain('A downgrade');
  });

  test('a tool error exits 1 with its message on stderr and nothing on stdout', async () => {
    const result = await run({
      args: ['plan', '--to', '9.9.9', '--package', '@venizia/kernel', '--app', appDir()],
    });

    expect(result.code).toBe(1);
    expect(result.err).toContain("unknown version '9.9.9'");
    expect(result.out).toBe('');
  });

  test('usage errors exit 2: no subcommand, another subcommand, no --to, an unknown flag, a bad format', async () => {
    for (const args of [
      [],
      ['apply'],
      ['plan'],
      ['plan', '--to', '2.0.0', '--nope', 'x'],
      ['plan', '--to', '2.0.0', '--format', 'xml'],
      ['plan', '--to'],
    ]) {
      const result = await run({ args });

      expect(result.code, args.join(' ')).toBe(2);
      expect(result.err, args.join(' ')).toContain('usage: vulcan x atlas migrate plan');
    }
  });

  test('flags the server reads (--root, --source, --cache-dir, --no-prebuilt) are accepted', async () => {
    const app = appDir();
    const result = await run({
      args: [
        'plan',
        '--root',
        app,
        '--no-prebuilt',
        '--cache-dir=/x',
        '--to',
        '2.0.0',
        '--package',
        '@venizia/kernel',
        '--app',
        app,
      ],
    });

    expect(result.code).toBe(0);
  });
});
