import { Glob } from 'bun';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { readProperty } from '../common/index.ts';
import { AppSides, CreateConstants } from './common/index.ts';
import type { ILocatedPreset, IPresetSpec, TAppSide, TPresetResult } from './common/index.ts';

const PRESET_SCHEMA = z
  .object({
    presetVersion: z.number(),
    side: z.string().refine((value): value is TAppSide => AppSides.isValid(value), {
      message: `one of: ${[...AppSides.SCHEME_SET].join(', ')}`,
    }),
    summary: z.string(),
    devPort: z.number().int().positive(),
    dependencies: z.record(z.string(), z.string()).default({}),
    devDependencies: z.record(z.string(), z.string()).default({}),
    peers: z.record(z.string(), z.string()).default({}),
    scripts: z.record(z.string(), z.string()).default({}),
    checks: z.array(z.string()).default([]),
    urls: z.array(z.string().startsWith('/')).default([]),
    imports: z.record(z.string(), z.string()).default({}),
    files: z.string(),
    atlas: z.array(z.object({ name: z.string(), repo: z.string(), ref: z.string() })).default([]),
  })
  // A check is run as `bun run <check>`; an entry that is not a script could be a bun flag.
  .superRefine((value, context) => {
    for (const key of Object.keys(value.imports)) {
      if (!key.startsWith('#')) {
        context.addIssue({
          code: 'custom',
          path: ['imports', key],
          message: `"${key}" is not a subpath import: a key starts with #`,
        });
      }
    }

    value.checks.forEach((check, index) => {
      if (!Object.hasOwn(value.scripts, check)) {
        context.addIssue({
          code: 'custom',
          path: ['checks', index],
          message: `"${check}" is not a key of scripts`,
        });
      }
    });
  });

const TOKEN = /\{\{(\w+)\}\}/g;
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const EXECUTABLE_BITS = 0o111;
const PERMISSION_BITS = 0o777;

const escapes = (opts: { root: string; path: string }): boolean => {
  const relativePath = relative(opts.root, opts.path);

  return isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`);
};

/** A path a preset names must stay inside its own package, with symlinks resolved. */
const resolveInside = (opts: { root: string; from: string; path: string }): string | undefined => {
  const resolved = resolve(opts.from, opts.path);

  if (escapes({ root: opts.root, path: resolved })) {
    return undefined;
  }

  if (
    existsSync(resolved) &&
    escapes({ root: realpathSync(opts.root), path: realpathSync(resolved) })
  ) {
    return undefined;
  }

  return resolved;
};

/** A file's text when it is UTF-8 without a NUL byte; undefined for anything else, which is data and is copied as it is. */
export const decodeText = (opts: { content: Buffer }): string | undefined => {
  if (opts.content.includes(0)) {
    return undefined;
  }

  try {
    return UTF8.decode(opts.content);
  } catch {
    return undefined;
  }
};

/** Text gets its tokens replaced; anything else is copied as it is. */
const substituteTokens = (opts: { content: Buffer; tokens: Record<string, string> }): Buffer => {
  const text = decodeText({ content: opts.content });

  return text === undefined
    ? opts.content
    : Buffer.from(text.replace(TOKEN, (match, key: string) => opts.tokens[key] ?? match));
};

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

export const readJson = (opts: { file: string }): Record<string, unknown> | undefined => {
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
  const vulcan = manifest[CreateConstants.PRESET_FIELD];
  const oldKeys = ['preset', 'lib'].filter(
    (key) => readProperty({ value: vulcan, key }) !== undefined,
  );

  // No fallback to the keys before `presets`: say what the contract is now.
  if (oldKeys.length > 0) {
    return {
      ok: false,
      error: `${shown} uses the old keys "vulcan": { ${oldKeys.map((key) => `"${key}"`).join(', ')} }; the contract is now "vulcan": { "presets": { "app": "./path/preset.json", "lib": "./path/lib.json" } }`,
    };
  }

  const presets = readProperty({ value: vulcan, key: 'presets' });
  const field = readProperty({ value: presets, key: 'app' });
  const libField = readProperty({ value: presets, key: 'lib' });

  if (typeof field !== 'string') {
    return {
      ok: false,
      error:
        typeof libField === 'string'
          ? `${shown}: vulcan.presets.lib needs vulcan.presets.app: a lib-only package is not supported`
          : `${shown} ships no VULCAN preset (no "vulcan": { "presets": { "app" } } in its package.json)`,
    };
  }

  const presetFile = resolveInside({ root: packageRoot, from: packageRoot, path: field });

  if (presetFile === undefined) {
    return {
      ok: false,
      error: `${shown}: vulcan.presets.app ${field} points outside the package`,
    };
  }

  const raw = readJson({ file: presetFile });

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
      .map((issue) => `${issue.path.join('.')} ${issue.message}`)
      .join('; ');

    return { ok: false, error: `${shown}: ${field}: ${issues}` };
  }

  const filesFolder = resolveInside({
    root: packageRoot,
    from: dirname(presetFile),
    path: parsed.data.files,
  });

  if (filesFolder === undefined) {
    return {
      ok: false,
      error: `${shown}: ${field}: files ${parsed.data.files} points outside the package`,
    };
  }

  const preset = { ...parsed.data, files: filesFolder };
  const libFile =
    typeof libField === 'string'
      ? resolveInside({ root: packageRoot, from: packageRoot, path: libField })
      : undefined;

  if (typeof libField === 'string' && libFile === undefined) {
    return {
      ok: false,
      error: `${shown}: vulcan.presets.lib ${libField} points outside the package`,
    };
  }

  const located: ILocatedPreset = {
    preset,
    ...(libFile === undefined ? {} : { libFile }),
    packageRoot,
    packageName,
    packageVersion,
  };

  return { ok: true, located };
};

/** One file a preset makes: where it lands in the app, what it holds once its tokens are replaced, its mode. */
export interface IRenderedPresetFile {
  path: string;
  content: Buffer;
  mode: number;
}

/**
 * Every file the preset makes, as the app would get it: the dotfile names, the tokens replaced, symlinks
 * skipped. Nothing is written: `copyPresetFiles` writes what this returns, and `preset diff` compares it.
 */
export const renderPresetFiles = (opts: {
  located: ILocatedPreset;
  tokens: Record<string, string>;
  /** The folder to render when it is not the app's: a lib preset's own. */
  files?: string;
}): IRenderedPresetFile[] => {
  const rendered: IRenderedPresetFile[] = [];
  const files = opts.files ?? opts.located.preset.files;

  for (const path of new Glob('**/*').scanSync({ cwd: files, dot: true })) {
    const source = join(files, path);

    // A link could point at any file on the machine; only real files belong to the preset.
    if (lstatSync(source).isSymbolicLink()) {
      continue;
    }

    const name = basename(path);

    rendered.push({
      path: CreateConstants.PRESET_DOTFILE_NAMES.includes(name)
        ? join(dirname(path), `.${name.slice(1)}`)
        : path,
      content: substituteTokens({ content: readFileSync(source), tokens: opts.tokens }),
      mode: statSync(source).mode,
    });
  }

  return rendered;
};

export const copyPresetFiles = (opts: {
  located: ILocatedPreset;
  target: string;
  tokens: Record<string, string>;
  /** The folder to copy when it is not the app's: a lib preset's own. */
  files?: string;
}): string[] => {
  const written: string[] = [];

  for (const file of renderPresetFiles(opts)) {
    const destination = join(opts.target, file.path);

    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, file.content);

    if (file.mode & EXECUTABLE_BITS) {
      chmodSync(destination, file.mode & PERMISSION_BITS);
    }

    written.push(file.path);
  }

  return written;
};
