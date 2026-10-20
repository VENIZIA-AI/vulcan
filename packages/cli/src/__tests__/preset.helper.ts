import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProject } from './project.helper.ts';

/** A copy of a preset fixture whose preset.json carries `fields` too; the fixture itself stays as it is. */
export const copyWithFields = (opts: {
  fixture: string;
  fields: Record<string, unknown>;
}): string => {
  const copy = createProject({ files: {} });

  cpSync(opts.fixture, copy, { recursive: true });

  const file = join(copy, 'vulcan-preset', 'preset.json');
  const preset = JSON.parse(readFileSync(file, 'utf8'));

  writeFileSync(file, JSON.stringify({ ...preset, ...opts.fields }, null, 2));

  return copy;
};

/** The same, for `urls`. */
export const copyWithUrls = (opts: { fixture: string; urls: string[] }): string =>
  copyWithFields({ fixture: opts.fixture, fields: { urls: opts.urls } });
