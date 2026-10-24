import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPort } from './workspace.ts';

/** One app of the monorepo as `make dev` serves it: its port, and the paths worth opening. */
export interface INextApp {
  port: number;
  urls: string[];
}

const readJson = (opts: { file: string }): Record<string, unknown> | undefined => {
  try {
    return JSON.parse(readFileSync(opts.file, 'utf8'));
  } catch (error) {
    console.error(
      `[readJson] ${opts.file} | ${error instanceof Error ? error.message : String(error)}`,
    );

    return undefined;
  }
};

/** The urls the preset recorded in the app's package.json at creation; none for an app made before. */
const readRecordedUrls = (opts: { directory: string }): string[] => {
  const file = join(opts.directory, 'package.json');
  const recorded = existsSync(file) ? readJson({ file })?.vulcan : undefined;
  const urls = (recorded as { urls?: unknown } | undefined)?.urls;

  return Array.isArray(urls) ? urls.filter((url) => typeof url === 'string') : [];
};

/** The apps already in the monorepo: those with a `*PORT=` line in .env.example, as they were made. */
export const readExistingApps = (opts: { root: string; paths: string[] }): INextApp[] =>
  opts.paths.flatMap((path) => {
    const directory = join(opts.root, path);
    const envFile = join(directory, '.env.example');
    const port = existsSync(envFile)
      ? readPort({ envExample: readFileSync(envFile, 'utf8') })
      : undefined;

    return port === undefined ? [] : [{ port, urls: readRecordedUrls({ directory }) }];
  });

/** The closing message: what ran, then one `open` line per url, or per app root when it has none. */
export const renderNext = (opts: { done: string; command: string; apps: INextApp[] }): string => {
  const lines = opts.apps.flatMap((app) =>
    (app.urls.length === 0 ? [''] : app.urls).map(
      (path) => `  open http://localhost:${app.port}${path}`,
    ),
  );

  return `${opts.done} Next:\n  ${opts.command}\n${lines.join('\n')}\n`;
};
