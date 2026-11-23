import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigLoader } from '../../config/index.ts';
import { ConfigLayers } from '../../config/layers.ts';
import { DoctorRunner } from '../../doctor/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { initRepo } from '../git-repo.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const [BASE] = ConfigLayers.shipped({ packs: [] }).layers;
const [, PACK] = ConfigLayers.shipped({ packs: ['venizia'] }).layers;

interface IShipped {
  claude: { settings: { permissions: { allow: string[]; deny?: string[] } } };
  digest?: { oftenDropped: string[] };
  presets?: { spec: string }[];
  atlas?: { sources: { name: string; repo: string }[] };
  doctor?: { privateValues: { acknowledged: { path: string; kinds: string[] }[] } };
}

const base = BASE?.value as unknown as IShipped;
const pack = PACK?.value as unknown as IShipped;
const project = (config: string): string =>
  createProject({ files: { '.configs/vulcan.config.mts': config } });
const effective = async (config: string) => {
  const loaded = await ConfigLoader.load({ root: project(config) });

  if (!loaded.ok) {
    throw new Error(loaded.error);
  }

  return loaded.config;
};

describe('what the base and the venizia pack ship', () => {
  test('the audited read-only allow list, its companion denies, the digest ids and the one acknowledgement', () => {
    expect(base.claude.settings.permissions.allow).toHaveLength(46);
    expect(base.claude.settings.permissions.deny).toHaveLength(24);
    expect(base.digest?.oftenDropped).toEqual([
      'V-P-07',
      'V-B-03',
      'V-P-05',
      'V-P-06',
      'V-B-04',
      'V-C-02',
      'V-C-09',
      'V-C-10',
      'V-P-08',
      'V-B-07',
      'V-B-09',
    ]);
    expect(base.doctor?.privateValues.acknowledged).toEqual([
      expect.objectContaining({ path: '**/Dockerfile*', kinds: ['machine-path'] }),
    ]);
  });

  test('the base denies no git write and allows nothing that writes or runs project code', () => {
    const everything = [
      ...base.claude.settings.permissions.allow,
      ...(base.claude.settings.permissions.deny ?? []),
    ].join('\n');

    for (const word of [
      'git commit',
      'git push',
      'git add',
      'git checkout',
      'git reset',
      'git pull',
      'bun fmt',
      'bun run',
      'bun test',
      'bun check',
      'make ',
      'devz',
    ]) {
      expect(everything, word).not.toContain(word);
    }
  });

  test('the pack carries the stack: presets, atlas sources and the five script lines', () => {
    expect(pack.presets?.map((preset) => preset.spec)).toEqual(['ignis', 'ardor']);
    expect(pack.atlas?.sources.map((source) => source.name)).toEqual(['ignis', 'ardor', 'vulcan']);
    expect(pack.claude.settings.permissions.allow).toEqual([
      'Bash(bun run typecheck:*)',
      'Bash(bun run test:*)',
      'Bash(bun run lint:*)',
      'Bash(bun test:*)',
      'Bash(bun check:*)',
    ]);
    expect(pack.claude.settings.permissions.deny).toBeUndefined();
  });
});

describe('the effective config of a project that writes none of it', () => {
  test('gets the base list, and the pack list only with the pack', async () => {
    const plain = await effective("export default { name: 'acme' };\n");
    const stack = await effective("export default { name: 'acme', packs: ['venizia'] };\n");
    const allowOf = (config: typeof plain): string[] =>
      (config.claude.settings.permissions as { allow: string[] }).allow;

    expect(allowOf(plain)).toHaveLength(46);
    expect(allowOf(stack)).toHaveLength(51);
    expect([...plain.digest.oftenDropped]).toEqual(base.digest?.oftenDropped ?? []);
    expect(plain.presets).toBeUndefined();
    expect(stack.presets?.map((preset) => preset.spec)).toEqual(['ignis', 'ardor']);
    expect(stack.atlas.sources.map((source) => source.name)).toEqual(['ignis', 'ardor', 'vulcan']);
    expect(plain.atlas.sources).toEqual([]);
    expect(plain.doctor.privateValues.acknowledged).toEqual([
      expect.objectContaining({ path: '**/Dockerfile*', kinds: ['machine-path'], standing: true }),
    ]);
  });

  test('a project adds its own, and remove takes any default out, base or pack', async () => {
    const config = await effective(`export default {
      name: 'acme',
      packs: ['venizia'],
      digest: { oftenDropped: ['P-02'] },
      claude: { settings: { permissions: { allow: ['Bash(make okf-check:*)'] } } },
      remove: {
        'digest.oftenDropped': ['V-P-07'],
        presets: ['ardor'],
        'atlas.sources': ['vulcan'],
        'claude.settings.permissions.allow': ['Bash(ps:*)', 'Bash(bun test:*)'],
      },
    };\n`);
    const allow = (config.claude.settings.permissions as { allow: string[] }).allow;

    expect(config.digest.oftenDropped).toHaveLength(11);
    expect(config.digest.oftenDropped).toContain('P-02');
    expect(config.digest.oftenDropped).not.toContain('V-P-07');
    expect(config.presets?.map((preset) => preset.spec)).toEqual(['ignis']);
    expect(config.atlas.sources.map((source) => source.name)).toEqual(['ignis', 'ardor']);
    expect(allow).toContain('Bash(make okf-check:*)');
    expect(allow).not.toContain('Bash(ps:*)');
    expect(allow).not.toContain('Bash(bun test:*)');
    expect(allow).toHaveLength(46 + 5 + 1 - 2);
  });

  test('a project that writes a line the base already has can delete it: --diff names it', () => {
    const root = project(
      "export default { name: 'acme', claude: { settings: { permissions: { allow: ['Bash(ls:*)', 'Bash(mine:*)'] } } } };\n",
    );
    const out = runCli({ args: ['config', '--diff'], cwd: root }).stdout;

    expect(out).toContain('claude.settings.permissions.allow[Bash(ls:*)]');
    expect(out).not.toContain('Bash(mine:*)');
  });

  test('sync writes the allow and deny lines into the Claude settings', () => {
    const root = project("export default { name: 'acme' };\n");

    expect(runCli({ args: ['sync', '--agents', 'claude'], cwd: root }).code).toBe(0);

    const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));

    expect(settings.permissions.allow).toContain('Bash(rg:*)');
    expect(settings.permissions.deny).toContain('Bash(rg *--pre*)');
    expect(settings.permissions.deny).not.toContain('Bash(git commit:*)');
  });

  test('the Dockerfile row hides a container path and nothing else', async () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.mts': "export default { name: 'acme' };\n",
        Dockerfile: 'FROM bun\nWORKDIR /home/app\n',
        'notes.md': 'my machine is /home/phat/work\n',
      },
    });

    initRepo({ cwd: root });

    const result = await DoctorRunner.runWarnings({ root });
    const warnings = result.filter((warning) => warning.check === 'private-values');
    const text = JSON.stringify(warnings);

    // The container path of the Dockerfile is acknowledged and the machine path of the notes is not.
    expect(text).toContain('notes.md');
    expect(text).not.toContain('Dockerfile');
  });

  test('a project with no Dockerfile is not told that the standing row matches nothing, and no note counts it', async () => {
    const root = createProject({
      files: { '.configs/vulcan.config.mts': "export default { name: 'acme' };\n" },
    });
    const all = await DoctorRunner.runWarnings({ root });

    expect(
      JSON.stringify(all.filter((warning) => warning.check === 'private-values')),
    ).not.toContain('matches no file');
    expect(JSON.stringify(all)).not.toContain('acknowledged in doctor.privateValues');
  });
});

/** The permission rule forms of Claude Code: `Bash(prefix:*)` is a command that starts with the prefix; any other `*` is any text. */
const matches = (opts: { rule: string; command: string }): boolean => {
  const inner = opts.rule.slice('Bash('.length, -1);

  if (inner.endsWith(':*')) {
    const prefix = inner.slice(0, -2);

    return opts.command === prefix || opts.command.startsWith(`${prefix} `);
  }

  return new RegExp(
    `^${inner
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  ).test(opts.command);
};

describe('every companion deny matches the flag form it targets', () => {
  // Each deny, the commands it must stop (all of which an allow rule of the base would otherwise let through).
  const TARGETS: Record<string, string[]> = {
    'Bash(file *-C*)': ['file -C -m magic.src', 'file -C'],
    'Bash(date *-s*)': ['date -s 2020-01-01', 'date -s "2020-01-01 10:00"'],
    'Bash(date *--set*)': ['date --set=2020-01-01'],
    'Bash(ss *-K*)': ['ss -K dst 10.0.0.1', 'ss -t -K'],
    'Bash(ss *--kill*)': ['ss --kill'],
    'Bash(rg *--pre*)': ['rg --pre cat foo', 'rg foo --pre=./run.sh'],
    'Bash(rg *--hostname-bin*)': ['rg --hostname-bin ./h foo'],
    'Bash(rg *--search-zip*)': ['rg --search-zip foo'],
    'Bash(rg *-z*)': ['rg -z foo', 'rg foo -z'],
    'Bash(sort *--compress-program*)': [
      'sort --compress-program=./x f',
      'sort -n --compress-program ./x f',
    ],
    'Bash(sort *--output*)': ['sort --output=out f', 'sort f --output out'],
    'Bash(sort *-o *)': ['sort -o out f', 'sort -n -o out f'],
    'Bash(git log *--output*)': ['git log --output=out', 'git log -5 --output out'],
    'Bash(git diff *--output*)': ['git diff --output=out', 'git diff HEAD~1 --output out'],
    'Bash(git show *--output*)': ['git show --output=out HEAD'],
    'Bash(git log *--ext-diff*)': ['git log -p --ext-diff'],
    'Bash(git diff *--ext-diff*)': ['git diff --ext-diff'],
    'Bash(git show *--ext-diff*)': ['git show --ext-diff HEAD'],
    'Bash(git blame *--textconv*)': ['git blame --textconv file'],
    'Bash(git diff *--textconv*)': ['git diff --textconv'],
    'Bash(git show *--textconv*)': ['git show --textconv HEAD:file'],
    'Bash(git log *--textconv*)': ['git log -p --textconv'],
    'Bash(git cat-file *--textconv*)': ['git cat-file --textconv HEAD:file'],
    'Bash(git cat-file *--filters*)': ['git cat-file --filters HEAD:file'],
  };
  const allow = base.claude.settings.permissions.allow;
  const deny = base.claude.settings.permissions.deny ?? [];

  test('the table covers every deny the base ships, and only those', () => {
    expect(Object.keys(TARGETS).sort()).toEqual([...deny].sort());
  });

  test.each(Object.keys(TARGETS))(
    '%s stops its flag forms, which an allow line would let through',
    (rule) => {
      for (const command of TARGETS[rule] ?? []) {
        expect(matches({ rule, command }), `${rule} should match: ${command}`).toBe(true);
        expect(
          allow.some((line) => matches({ rule: line, command })),
          `an allow line should cover: ${command}`,
        ).toBe(true);
      }
    },
  );

  test('the reading forms of the same commands are not denied', () => {
    for (const command of [
      'rg foo src',
      'rg -n --glob "*.ts" foo',
      'sort -n file',
      'sort -u a b',
      'git log --oneline -5',
      'git diff HEAD~1',
      'git show HEAD',
      'git blame file',
      'git cat-file -p HEAD',
      'ss -tlnp',
      'date +%s',
      'date',
      'file a.txt',
    ]) {
      expect(
        deny.some((rule) => matches({ rule, command })),
        command,
      ).toBe(false);
      expect(
        allow.some((line) => matches({ rule: line, command })),
        `still allowed: ${command}`,
      ).toBe(true);
    }
  });

  test('a form the patterns cannot see is a known limit, written down (an attached short flag)', () => {
    // `sort -ofile` carries the flag glued to its value: the `*-o *` pattern needs a space after it and does not match.
    // The write guards (guard-outside, guard-writes) are what stand between that form and a write outside the project.
    expect(deny.some((rule) => matches({ rule, command: 'sort -ofile f' }))).toBe(false);
    // The same for a short flag inside a group (`ss -tK`, `rg -uz`): the patterns look for `-K` and `-z` as their own words.
    expect(deny.some((rule) => matches({ rule, command: 'ss -tK' }))).toBe(false);
    expect(deny.some((rule) => matches({ rule, command: 'rg foo -uz' }))).toBe(false);
    // `date -s2020-01-01` is caught because its deny does not need the space.
    expect(deny.some((rule) => matches({ rule, command: 'date -s2020-01-01' }))).toBe(true);
  });
});
