import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ConfigLoader } from '../../config/index.ts';
import { ConfigLayers } from '../../config/layers.ts';
import { DoctorRunner } from '../../doctor/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { initRepo } from '../git-repo.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const [BASE] = ConfigLayers.shipped({ packs: [] }).layers;
const [, PACK] = ConfigLayers.shipped({ packs: ['venizia'] }).layers;

const PERMISSIONS = z.object({ allow: z.array(z.string()), deny: z.array(z.string()).optional() });
const SHIPPED_SCHEMA = z.object({
  claude: z.object({ settings: z.object({ permissions: PERMISSIONS }) }),
  digest: z.object({ oftenDropped: z.array(z.string()) }).optional(),
  presets: z.array(z.object({ spec: z.string() })).optional(),
  atlas: z
    .object({ sources: z.array(z.object({ name: z.string(), repo: z.string() })) })
    .optional(),
  doctor: z
    .object({
      privateValues: z.object({
        acknowledged: z.array(z.object({ path: z.string(), kinds: z.array(z.string()) })),
      }),
    })
    .optional(),
});
const shippedOf = (opts: { value: unknown }) => SHIPPED_SCHEMA.parse(opts.value);

const base = shippedOf({ value: BASE?.value });
const pack = shippedOf({ value: PACK?.value });
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
    expect(base.claude.settings.permissions.allow).toHaveLength(42);
    expect(base.claude.settings.permissions.deny).toHaveLength(14);
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

describe('the pack gives the stack its guard and commit defaults', () => {
  test('a project with the venizia pack denies writes outside the project and agent signatures; one without keeps ask and allow', async () => {
    const stack = await effective("export default { name: 'acme', packs: ['venizia'] };\n");
    const plain = await effective("export default { name: 'acme' };\n");

    expect(stack.guard.outside).toBe('deny');
    expect(stack.commit.message.agent.signature).toBe('deny');
    expect(plain.guard.outside).toBe('ask');
    expect(plain.commit.message.agent.signature).toBe('allow');
  });

  test('the project file overrides the pack, and sync writes the guard to the manifest', async () => {
    const own = await effective(
      "export default { name: 'acme', packs: ['venizia'], guard: { outside: 'ask' }, commit: { message: { agent: { signature: 'allow' } } } };\n",
    );

    expect(own.guard.outside).toBe('ask');
    expect(own.commit.message.agent.signature).toBe('allow');

    const root = project("export default { name: 'acme', packs: ['venizia'] };\n");

    expect(runCli({ args: ['sync', '--agents', 'claude'], cwd: root }).code).toBe(0);
    expect(
      JSON.parse(readFileSync(join(root, '.agents/vulcan.manifest.json'), 'utf8')).guard.outside,
    ).toBe('deny');
  });

  test('doctor says how many lines repeat the defaults, and warns about a remove that matches nothing', async () => {
    const repeats = project(
      "export default { name: 'acme', packs: ['venizia'], guard: { outside: 'deny' } };\n",
    );
    const clean = project("export default { name: 'acme', packs: ['venizia'] };\n");
    const stale = project(
      "export default { name: 'acme', remove: { 'atlas.sources': ['ghost'] } };\n",
    );
    const repeatsFound = await DoctorRunner.runNotes({ root: repeats });
    const cleanFound = await DoctorRunner.runNotes({ root: clean });
    const staleFound = await DoctorRunner.runWarnings({ root: stale });
    const cleanWarned = await DoctorRunner.runWarnings({ root: clean });
    const repeatsNotes = JSON.stringify(repeatsFound);
    const cleanNotes = JSON.stringify(cleanFound);
    const staleWarnings = JSON.stringify(staleFound);
    const cleanWarnings = JSON.stringify(cleanWarned);

    const auto = project(
      "export default { name: 'acme', board: { serve: { autoStart: true } } };\n",
    );
    const autoFound = await DoctorRunner.runNotes({ root: auto });

    expect(JSON.stringify(autoFound)).toContain(
      'board.serve.autoStart is on, but events.log is off',
    );
    expect(cleanNotes).not.toContain('autoStart');
    expect(repeatsNotes).toContain('1 value(s) of this config repeat what VULCAN ships');
    expect(repeatsNotes).toContain('config --diff');
    expect(cleanNotes).not.toContain('repeat what VULCAN ships');
    expect(staleWarnings).toContain('remove: atlas.sources: ghost matches nothing');
    expect(cleanWarnings).not.toContain('matches nothing');
  });
});

describe('the effective config of a project that writes none of it', () => {
  test('gets the base list, and the pack list only with the pack', async () => {
    const plain = await effective("export default { name: 'acme' };\n");
    const stack = await effective("export default { name: 'acme', packs: ['venizia'] };\n");
    const allowOf = (config: typeof plain): string[] =>
      PERMISSIONS.parse(config.claude.settings.permissions).allow;

    expect(allowOf(plain)).toHaveLength(42);
    expect(allowOf(stack)).toHaveLength(47);
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
        'claude.settings.permissions.allow': ['Bash(date:*)', 'Bash(bun test:*)'],
      },
    };\n`);
    const allow = PERMISSIONS.parse(config.claude.settings.permissions).allow;

    expect(config.digest.oftenDropped).toHaveLength(11);
    expect(config.digest.oftenDropped).toContain('P-02');
    expect(config.digest.oftenDropped).not.toContain('V-P-07');
    expect(config.presets?.map((preset) => preset.spec)).toEqual(['ignis']);
    expect(config.atlas.sources.map((source) => source.name)).toEqual(['ignis', 'ardor']);
    expect(allow).toContain('Bash(make okf-check:*)');
    expect(allow).not.toContain('Bash(date:*)');
    expect(allow).not.toContain('Bash(bun test:*)');
    expect(allow).toHaveLength(42 + 5 + 1 - 2);
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
    'Bash(date *-s*)': ['date -s 2020-01-01', 'date -s "2020-01-01 10:00"'],
    'Bash(date *--set*)': ['date --set=2020-01-01'],
    'Bash(rg *--pre*)': ['rg --pre cat foo', 'rg foo --pre=./run.sh'],
    'Bash(rg *--hostname-bin*)': ['rg --hostname-bin ./h foo'],
    'Bash(git *--output*)': [
      'git log --output=out',
      'git log -5 --output out',
      'git diff --output=out',
      'git diff HEAD~1 --output out',
      'git show --output=out HEAD',
      'git rev-list --output=x HEAD',
      'git blame --output=x f',
    ],
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

  test('the reading forms of the same commands are not denied, and a regex with -z in it is not mistaken for a flag', () => {
    for (const command of [
      'rg foo src',
      'rg -n --glob "*.ts" foo',
      "rg '[a-z]+' src",
      "rg -e 'a-z' -g '*-zip*'",
      'git log --oneline -5',
      'git diff HEAD~1',
      'git show HEAD',
      'git blame file',
      'git cat-file -p HEAD',
      'date +%s',
      'date',
      'ls User-Card.tsx',
      'grep -rn foo src',
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

  test('the commands that can write or print secrets from their own flags are not allowed at all', () => {
    for (const command of [
      'sort -ofile f',
      'sort --output=f f',
      'ss -D out',
      'file --compile -m m',
      'ps eww',
    ]) {
      expect(
        allow.some((line) => matches({ rule: line, command })),
        command,
      ).toBe(false);
    }
  });

  test('the date deny is not widened to a grouped form: it would refuse `date -u +%s`, which only reads', () => {
    expect(deny.some((rule) => matches({ rule, command: 'date -u +%s' }))).toBe(false);
    expect(deny.some((rule) => matches({ rule, command: 'date -d @0 +%s' }))).toBe(false);
    // `date -us x` (grouped) is a known limit: setting the clock needs root, and it fails without it.
    expect(deny.some((rule) => matches({ rule, command: 'date -us x' }))).toBe(false);
  });

  test('known limits, written down: a flag glued to its value, and an environment prefix, are not seen by a pattern', () => {
    // `date -s2020-01-01` is caught because its deny needs no space; `git diff --output=x` after an environment prefix is not
    // matched by the allow line either, so Claude Code asks (whether its matcher splits the prefix is not verified here).
    expect(deny.some((rule) => matches({ rule, command: 'date -s2020-01-01' }))).toBe(true);
    expect(deny.some((rule) => matches({ rule, command: 'GIT_EXTERNAL_DIFF=./x git diff' }))).toBe(
      false,
    );
    expect(
      allow.some((line) => matches({ rule: line, command: 'GIT_EXTERNAL_DIFF=./x git diff' })),
    ).toBe(false);
  });
});
