import { Glob } from 'bun';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { AppSides, CreateConstants } from './common/index.ts';
import type { ILocatedPreset, IPreset, IPresetSpec, TPresetResult } from './common/index.ts';

const PRESET_SCHEMA = z.object({
  presetVersion: z.number(),
  side: z.string().refine(value => AppSides.isValid(value), {
    message: `one of: ${[...AppSides.SCHEME_SET].join(', ')}`,
  }),
  summary: z.string(),
  devPort: z.number().int().positive(),
  dependencies: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
  peers: z.record(z.string(), z.string()).default({}),
  scripts: z.record(z.string(), z.string()).default({}),
  checks: z.array(z.string()).default([]),
  files: z.string(),
  atlas: z.array(z.object({ name: z.string(), repo: z.string(), ref: z.string() })).default([]),
});

const TOKEN = /\{\{(\w+)\}\}/g;

export const parsePresetSpec = (opts: { value: string; cwd: string }): IPresetSpec => {
  if (opts.value.startsWith(CreateConstants.PRESET_FILE_PREFIX)) {
    const path = opts.value.slice(CreateConstants.PRESET_FILE_PREFIX.length);

    return { range: `${CreateConstants.PRESET_FILE_PREFIX}${resolve(opts.cwd, path)}` };
  }

  // The version separator is the last '@' that is not the scope's leading one.
  const at = opts.value.lastIndexOf('@');
  const [name, range] =
    at > 0 ? [opts.value.slice(0, at), opts.value.slice(at + 1)] : [opts.value, 'latest'];
  const packageName = name.startsWith('@') ? name : `${CreateConstants.PRESET_SCOPE}${name}`;

  return { packageName, range };
};

const readJson = (opts: { file: string }): Record<string, unknown> | undefined => {
  if (!existsSync(opts.file)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(opts.file, 'utf8'));
  } catch (error) {
    console.error(
      `[readJson] ${opts.file} | ${error instanceof Error ? error.message : String(error)}`,
    );

    return undefined;
  }
};

export const locatePreset = (opts: { spec: IPresetSpec; root: string }): TPresetResult => {
  const packageRoot =
    opts.spec.packageName === undefined
      ? opts.spec.range.slice(CreateConstants.PRESET_FILE_PREFIX.length)
      : join(opts.root, 'node_modules', opts.spec.packageName);
  const manifest = readJson({ file: join(packageRoot, 'package.json') });

  if (manifest === undefined) {
    return { ok: false, error: `no package at ${packageRoot} - was it installed?` };
  }

  const packageName = String(manifest.name);
  const packageVersion = String(manifest.version);
  const shown = `${packageName}@${packageVersion}`;
  const field = (manifest[CreateConstants.PRESET_FIELD] as { preset?: unknown } | undefined)
    ?.preset;

  if (typeof field !== 'string') {
    return {
      ok: false,
      error: `${shown} ships no VULCAN preset (no "vulcan": { "preset" } in its package.json)`,
    };
  }

  const raw = readJson({ file: join(packageRoot, field) });

  if (raw === undefined) {
    return { ok: false, error: `${shown}: ${field} is missing or not JSON` };
  }

  if (raw.presetVersion !== CreateConstants.PRESET_VERSION) {
    return {
      ok: false,
      error: `${shown} has preset version ${String(raw.presetVersion)}; this VULCAN reads version ${CreateConstants.PRESET_VERSION} - upgrade @venizia/vulcan`,
    };
  }

  const parsed = PRESET_SCHEMA.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(issue => `${issue.path.join('.')} ${issue.message}`)
      .join('; ');

    return { ok: false, error: `${shown}: ${field}: ${issues}` };
  }

  const preset = {
    ...parsed.data,
    files: join(dirname(join(packageRoot, field)), parsed.data.files),
  } as IPreset;
  const located: ILocatedPreset = { preset, packageRoot, packageName, packageVersion };

  return { ok: true, located };
};

export const copyPresetFiles = (opts: {
  located: ILocatedPreset;
  target: string;
  tokens: Record<string, string>;
}): string[] => {
  const written: string[] = [];

  for (const path of new Glob('**/*').scanSync({ cwd: opts.located.preset.files, dot: true })) {
    const name = basename(path);
    const relativePath = name.startsWith(CreateConstants.PRESET_DOTFILE_PREFIX)
      ? join(dirname(path), `.${name.slice(CreateConstants.PRESET_DOTFILE_PREFIX.length)}`)
      : path;
    const content = readFileSync(join(opts.located.preset.files, path), 'utf8').replace(
      TOKEN,
      (match, key: string) => opts.tokens[key] ?? match,
    );

    mkdirSync(dirname(join(opts.target, relativePath)), { recursive: true });
    writeFileSync(join(opts.target, relativePath), content);
    written.push(relativePath);
  }

  return written;
};
