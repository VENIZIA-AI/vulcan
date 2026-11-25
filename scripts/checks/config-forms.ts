import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigCodemod } from '../../packages/cli/src/config/codemod.ts';
import { ConfigGroups } from '../../packages/cli/src/config/groups.ts';

const ROOT = join(import.meta.dir, '..', '..');

/** What is read: the wiki, the shipped base texts and the package READMEs. The changelogs are frozen history and say the old keys on purpose. */
const SCANNED =
  /^(?:docs\/wiki\/content\/(?!changelogs\/)|packages\/[a-z-]+\/(?:base\/|README\.md))[^]*\.md$/;
/** The user-facing strings of the sources: a key named between escaped backticks in a template string (`\\`events.log\\``). Tests and generated files are not read. */
const SOURCE = /^packages\/[a-z-]+\/src\/(?!__tests__\/)[^]*\.(?:ts|tsx)$/;
const SOURCE_PATH = /\\`([a-zA-Z]+(?:\.[a-zA-Z[\]<>*-]+)+)\\`/g;
/** The first word of a flat config path: a backticked `events.log` is the flat key, `board.events.log` is the key. */
const FLAT_HEADS = new Set([
  'events',
  'local',
  'okf',
  'atlas',
  'doctor',
  'commit',
  'digest',
  'owner',
  'claude',
  'theme',
  'layout',
  'packages',
  'presets',
  'packs',
  'rules',
  'agents',
  'provider',
]);
const DOC_PATH = /`([a-zA-Z]+(?:\.[a-zA-Z[\]<>*-]+)+)`/g;
const FILE_NAME = /\.(?:md|ts|mts|json|yaml|yml|js|mjs|html|css|sh|toml|txt)$/;
/**
 * Dotted words that look like a flat config key and are not one: the keys of a preset package's `package.json`, and the keys of the
 * generated manifest, which keeps the flat names. Each entry is a file and the word; the test of this gate pins the list.
 */
const NOT_CONFIG: readonly { file: string; token: string }[] = [
  { file: 'docs/wiki/content/references/presets.md', token: 'presets.app' },
  { file: 'docs/wiki/content/references/presets.md', token: 'presets.lib' },
  { file: 'docs/wiki/content/references/presets.md', token: 'presets.shared' },
  { file: 'docs/wiki/content/references/presets.md', token: 'presets.files' },
  { file: 'docs/wiki/content/references/commands/sync.md', token: 'rules.base' },
];

export interface IConfigFormHit {
  file: string;
  line: number;
  text: string;
  reason: string;
}

export class ConfigForms {
  static readonly NOT_CONFIG = NOT_CONFIG;

  /** Every config sample in the flat shape and every flat key path of the given texts. */
  static scan(opts: { files: { file: string; text: string }[] }): IConfigFormHit[] {
    return opts.files.flatMap(({ file, text }) => {
      if (SOURCE.test(file)) {
        return ConfigForms.paths({ file, text, pattern: SOURCE_PATH });
      }

      return SCANNED.test(file)
        ? [
            ...ConfigForms.samples({ file, text }),
            ...ConfigForms.paths({ file, text, pattern: DOC_PATH }),
          ]
        : [];
    });
  }

  /** A fenced block with `export default {` that the groups codemod would still rewrite is a flat sample. */
  private static samples(opts: { file: string; text: string }): IConfigFormHit[] {
    const hits: IConfigFormHit[] = [];

    for (const found of opts.text.matchAll(/```(?:ts|typescript|js)\n([^]*?)```/g)) {
      const body = found[1] ?? '';

      if (!body.includes('export default {')) {
        continue;
      }

      const run = ConfigCodemod.run({
        root: ROOT,
        read: (path) => (path === '.configs/vulcan.config.mts' ? body : undefined),
      });
      const isFlat =
        run.ok && run.changes.some((change) => change.path === '.configs/vulcan.config.mts');

      if (isFlat) {
        hits.push({
          file: opts.file,
          line: opts.text.slice(0, found.index).split('\n').length + 1,
          text: 'a config sample in the flat shape',
          reason: 'write it in the seven groups (`vulcan config codemod config-groups`)',
        });
      }
    }

    return hits;
  }

  /** A backticked dotted word that is the flat path of a key which moved: `events.log` is `board.events.log`. */
  private static paths(opts: { file: string; text: string; pattern: RegExp }): IConfigFormHit[] {
    return opts.text.split('\n').flatMap((line, index) =>
      [...line.matchAll(opts.pattern)].flatMap((found) => {
        const token = found[1] ?? '';

        if (
          !FLAT_HEADS.has(token.split('.')[0] ?? '') ||
          FILE_NAME.test(token) ||
          NOT_CONFIG.some((entry) => entry.file === opts.file && entry.token === token)
        ) {
          return [];
        }

        const grouped = ConfigGroups.groupedPathOf({ path: token });

        return grouped === token
          ? []
          : [
              {
                file: opts.file,
                line: index + 1,
                text: `\`${token}\``,
                reason: `the key is \`${grouped}\``,
              },
            ];
      }),
    );
  }

  static tracked(): { file: string; text: string }[] {
    const listed = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });

    return listed.stdout
      .split('\0')
      .filter((file) => file !== '' && (SCANNED.test(file) || SOURCE.test(file)))
      .flatMap((file) => {
        try {
          return [{ file, text: readFileSync(join(ROOT, file), 'utf8') }];
        } catch {
          return [];
        }
      });
  }
}

if (import.meta.main) {
  const hits = ConfigForms.scan({ files: ConfigForms.tracked() });

  for (const hit of hits) {
    process.stderr.write(`${hit.file}:${hit.line}: ${hit.text}: ${hit.reason}\n`);
  }

  if (hits.length > 0) {
    process.stderr.write(
      `config-forms: ${hits.length} place(s) show the flat config; the groups are in packages/cli/src/config/groups.ts (ConfigGroups.GROUPS)\n`,
    );
  }

  process.exit(hits.length === 0 ? 0 : 1);
}
