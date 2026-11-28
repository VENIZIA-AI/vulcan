import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectConfig } from '@/common/project-config';
import { SymbolCompute } from '@/symbols/compute';
import { ApiReference } from './generator';
import { ApiPackages } from './packages';

/** `vulcan atlas api gen|check|undocumented`: runs the API reference and prints what it found. */
export class ApiCommand {
  private static readonly USAGE =
    'usage: vulcan atlas api gen|check | undocumented [--package <dir, name or path>]...';

  static run(opts: { command?: string; args?: string[] }): number {
    if (opts.command !== 'gen' && opts.command !== 'check' && opts.command !== 'undocumented') {
      console.error(ApiCommand.USAGE);

      return 2;
    }

    const project = ProjectConfig.readAtlasProject();
    const wiki = project.knowledge.wiki;

    if (wiki === undefined) {
      console.error(
        'vulcan atlas api: this project declares no wiki (knowledge.wiki in the config)',
      );

      return 1;
    }

    const { names: only, unmatched } = ApiPackages.resolve({ args: opts.args ?? [], project });

    if (unmatched.length > 0) {
      console.error(
        unmatched.includes('')
          ? 'vulcan atlas api: --package needs a value (a package dir, npm name or path)'
          : `vulcan atlas api: --package ${unmatched.map((value) => `'${value}'`).join(', ')} matches no package of this project (use its dir, npm name or path)`,
      );

      return 2;
    }

    // Only `undocumented` reads a package that publishes its source: a page or a check of pages needs declaration text.
    const all = SymbolCompute.symbolsOfRepository({
      project,
      withSource: opts.command === 'undocumented',
    });
    const records =
      only === undefined ? all : all.filter((record) => only.includes(record.package));

    if (records.length === 0) {
      console.error('vulcan atlas api: no exports found - build the packages first');

      return 1;
    }

    if (opts.command === 'undocumented') {
      const gaps = ApiReference.undocumentedOf({
        records,
        packages: project.packages.map((item) => ({ name: item.name, path: item.path })),
      });

      if (gaps.length === 0) {
        console.log('every export has TSDoc');

        return 0;
      }

      for (const gap of gaps) {
        console.error(`${gap.specifier}: ${gap.names.join(', ')}`);
      }

      console.error(
        `${gaps.reduce((sum, gap) => sum + gap.names.length, 0)} exports have no TSDoc`,
      );

      return 1;
    }

    const packages = project.packages.map((item) => ({ name: item.name, path: item.path }));
    const expected = ApiReference.filesOf({ records, packages });
    const directory = join(wiki, ApiReference.DIRECTORY);

    if (opts.command === 'check') {
      const stale = ApiReference.staleOf({ expected, directory });

      if (stale.length === 0) {
        console.log(`fresh ${ApiReference.DIRECTORY} (${expected.size} files)`);

        return 0;
      }

      console.error(
        `stale ${ApiReference.DIRECTORY}: ${stale.join(', ')} - the public API or its TSDoc changed; run \`vulcan atlas api gen\``,
      );

      return 1;
    }

    mkdirSync(directory, { recursive: true });

    for (const name of ApiReference.staleOf({ expected, directory })) {
      if (!expected.has(name)) {
        rmSync(join(directory, name));
      }
    }

    for (const [file, text] of expected) {
      writeFileSync(join(directory, file), text);
    }

    console.log(`wrote ${expected.size} files to ${ApiReference.DIRECTORY}`);

    return 0;
  }
}
