import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IProjectPackage } from '../config/index.ts';
import { TerminalCapability, TerminalPrompt } from '../ui/index.ts';
import { AddConstants, CreateFlags } from './common/index.ts';
import { ProjectNames } from './names.ts';
import { PortRegistry } from './workspace.ts';

const NO_BACKEND = ':none';

/** The backend app a frontend proxies to. */
export class ApiProxyResolver {
  /** A frontend's proxy target: the chosen backend app's port, or nothing when it has no backend. */
  static async resolveApiUrl(opts: {
    root: string;
    args: string[];
    interactive: boolean;
    backendFolders: string[];
    packages: IProjectPackage[];
  }): Promise<{ ok: true; apiUrl: string } | { ok: false; error: string }> {
    if (opts.args.includes(CreateFlags.NO_API)) {
      return { ok: true, apiUrl: '' };
    }

    let chosen = ProjectNames.readFlag({ args: opts.args, flag: CreateFlags.API });

    if (chosen === undefined) {
      if (!opts.interactive) {
        return { ok: false, error: AddConstants.MISSING_API };
      }

      if (TerminalCapability.menusAvailable()) {
        const backends = opts.packages.filter((entry) =>
          opts.backendFolders.some((folder) => entry.path.startsWith(`${folder}/`)),
        );

        // Nothing to pick from: a frontend of a project without a backend has nothing to proxy to.
        if (backends.length === 0) {
          return { ok: true, apiUrl: '' };
        }

        const picked = await TerminalPrompt.promptSelect({
          message: 'Backend app to proxy /api to',
          choices: [
            ...backends.map((entry) => ({ value: entry.dir, label: entry.dir, hint: entry.path })),
            { value: NO_BACKEND, label: 'none', hint: 'no proxy' },
          ],
        });

        if (picked === null) {
          return { ok: false, error: 'aborted' };
        }

        chosen = picked === NO_BACKEND ? '' : picked;
      } else {
        chosen =
          ProjectNames.askWithPrompt({
            question: 'Backend app to proxy /api to (empty for none)',
          })?.trim() ?? '';
      }

      if (chosen === '') {
        return { ok: true, apiUrl: '' };
      }
    }

    const backend = opts.packages.find(
      (entry) =>
        entry.dir === chosen &&
        opts.backendFolders.some((folder) => entry.path.startsWith(`${folder}/`)),
    );

    if (backend === undefined) {
      return {
        ok: false,
        error: `${CreateFlags.API} '${chosen}' is not a backend app of this monorepo`,
      };
    }

    const envFile = join(opts.root, backend.path, '.env.example');
    const port = existsSync(envFile)
      ? PortRegistry.read({ envExample: readFileSync(envFile, 'utf8') })
      : undefined;

    if (port === undefined) {
      return {
        ok: false,
        error: `no *PORT=<number> line in ${backend.path}/.env.example to proxy to`,
      };
    }

    return { ok: true, apiUrl: `http://localhost:${port}` };
  }
}
