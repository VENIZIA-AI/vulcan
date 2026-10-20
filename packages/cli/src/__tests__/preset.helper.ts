import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProject } from './project.helper.ts';

/** A copy of a preset fixture whose preset.json carries `urls`; the fixture itself stays as it is. */
export const copyWithUrls = (opts: { fixture: string; urls: string[] }): string => {
  const copy = createProject({ files: {} });

  cpSync(opts.fixture, copy, { recursive: true });

  const file = join(copy, 'vulcan-preset', 'preset.json');
  const preset = JSON.parse(readFileSync(file, 'utf8'));

  writeFileSync(file, JSON.stringify({ ...preset, urls: opts.urls }, null, 2));

  return copy;
};
