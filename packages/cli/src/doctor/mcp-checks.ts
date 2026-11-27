import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectLayout, RecordValue } from '../common/index.ts';
import { MCP_SERVER_HINT } from '../init/index.ts';
import { AgentScopes, AgentSelection, AgentTable } from '../agents/index.ts';
import { DoctorChecks } from './common/index.ts';
import type { ICheckContext, IViolation } from './common/index.ts';
import { DoctorCheckUtility } from './utilities/doctor-check.utility.ts';

const CANONICAL_ATLAS_ARGS = ['node_modules/.bin/vulcan', 'atlas', 'mcp', '--root', '.'];
/** The entry of the release before the scopes: it still runs, so it is out of date and not a different server. */
const PREVIOUS_ATLAS_ARGS = ['node_modules/.bin/vulcan', 'x', 'atlas', 'mcp', '--root', '.']; // retired-form: the entry of the release before the scopes
/** What sync wrote before V-S-08: it can run a copy bunx cached, so it is stale and not merely different. */
const LEGACY_ATLAS_ARGS = ['x', '--no-install', 'vulcan', 'x', 'atlas', 'mcp', '--root', '.']; // retired-form: the entry an earlier release wrote, which a sync still recognises

const MCP_FILE = '.mcp.json';

const CLAUDE_SETTINGS_FILE = '.claude/settings.json';

const ATLAS_SERVER = 'atlas';

/** Whether git lists the file as untracked and not ignored: what a clean-tree check, such as a release, refuses on. */
const isUntrackedAndVisible = (opts: { root: string; path: string }): boolean => {
  const listed = spawnSync('git', ['status', '--porcelain', '--', opts.path], {
    cwd: opts.root,
    encoding: 'utf8',
    timeout: 5000,
  });

  return listed.status === 0 && listed.stdout.startsWith('?? ');
};

const mcpWarning = (opts: { file: string; message: string }): IViolation =>
  DoctorCheckUtility.createViolation({
    check: DoctorChecks.MCP,
    file: opts.file,
    message: opts.message,
  });

/** The check of how the atlas server is registered in `.mcp.json` and enabled in the Claude settings. */
export class McpChecks {
  /**
   * The atlas server is registered the one way every project does: the root `.mcp.json` (a per-machine
   * file `sync` writes for the agents that read it) holds an `atlas` entry that runs the project's own
   * atlas (`--root .`), and the managed Claude settings enable `atlas` by that name. A server under
   * another name, or one that serves another folder, is never enabled automatically or serves the wrong
   * knowledge. One that is untracked and not ignored is told how to hide it. Warnings, not violations.
   */
  static checkMcpAtlas(opts: ICheckContext): IViolation[] {
    const warnings: IViolation[] = [];
    const file = join(opts.root, MCP_FILE);
    const chosen = AgentSelection.resolveQuietly({
      root: opts.root,
      configAgents: opts.config.agents,
    });
    const readsMcpFile = AgentTable.read().some(
      (entry) => chosen.includes(entry.id) && entry.mcp.scope === AgentScopes.SHARED,
    );

    // The root `.mcp.json` is a per-machine file of the agents that read it; a missing one is the
    // `adapters` check's (not synced yet), so only an existing file is looked at.
    if (readsMcpFile && existsSync(file)) {
      if (isUntrackedAndVisible({ root: opts.root, path: MCP_FILE })) {
        warnings.push(
          mcpWarning({
            file: MCP_FILE,
            message:
              'untracked and not ignored, so a clean-tree check (a release) refuses to run. Add `/.mcp.json` to .gitignore, or run `vulcan project sync` at the top level of the repository, which lists it in .git/info/exclude.',
          }),
        );
      }

      const parsed = DoctorCheckUtility.readJsonObject({ file });

      if (parsed === undefined) {
        warnings.push(
          mcpWarning({
            file: MCP_FILE,
            message: `not valid JSON - it must hold ${MCP_SERVER_HINT} under mcpServers`,
          }),
        );
      } else {
        const holder = { value: parsed['mcpServers'] };
        const servers = RecordValue.isRecord(holder.value) ? holder.value : {};
        const entry = { value: servers[ATLAS_SERVER] };
        const args = RecordValue.isRecord(entry.value) ? entry.value['args'] : undefined;
        const isCanonical =
          RecordValue.isRecord(entry.value) &&
          entry.value['command'] === 'bun' &&
          Array.isArray(args) &&
          args.length === CANONICAL_ATLAS_ARGS.length &&
          args.every((arg, index) => arg === CANONICAL_ATLAS_ARGS[index]);

        if (!RecordValue.isRecord(entry.value)) {
          warnings.push(
            mcpWarning({
              file: MCP_FILE,
              message: `no server named atlas (found: ${Object.keys(servers).join(', ') || 'none'}): a differently named server is not enabled automatically - use ${MCP_SERVER_HINT}`,
            }),
          );
        } else if (
          Array.isArray(args) &&
          args.length === PREVIOUS_ATLAS_ARGS.length &&
          args.every((arg, index) => arg === PREVIOUS_ATLAS_ARGS[index])
        ) {
          warnings.push(
            mcpWarning({
              file: MCP_FILE,
              message: `the atlas entry is out of date: it starts the server with the old \`x atlas\` form, which is \`atlas\` now (the old name still works in this release) - run '${ProjectLayout.VULCAN_COMMAND} project sync' to rewrite it as ${MCP_SERVER_HINT}`,
            }),
          );
        } else if (
          Array.isArray(args) &&
          args.length === LEGACY_ATLAS_ARGS.length &&
          args.every((arg, index) => arg === LEGACY_ATLAS_ARGS[index])
        ) {
          warnings.push(
            mcpWarning({
              file: MCP_FILE,
              message: `the atlas entry is out of date: it starts the server through bunx, which can run a copy it cached when the bin is not linked there - run '${ProjectLayout.VULCAN_COMMAND} project sync' to rewrite it as ${MCP_SERVER_HINT}`,
            }),
          );
        } else if (!isCanonical) {
          const shown = JSON.stringify(entry.value)
            .replace('{"command":', '{ "command": ')
            .replace(',"args":[', ', "args": [')
            .replaceAll('","', '", "')
            .replace(/\]\}$/, '] }');

          warnings.push(
            mcpWarning({
              file: MCP_FILE,
              message: `the atlas entry is ${shown}, expected ${MCP_SERVER_HINT}`,
            }),
          );
        }
      }
    }

    const settings = join(opts.root, CLAUDE_SETTINGS_FILE);
    const enabled = existsSync(settings)
      ? DoctorCheckUtility.readJsonObject({ file: settings })?.['enabledMcpjsonServers']
      : undefined;

    if (existsSync(settings) && !(Array.isArray(enabled) && enabled.includes(ATLAS_SERVER))) {
      const has = Array.isArray(enabled) ? enabled.map(String).join(', ') : 'none';

      warnings.push(
        mcpWarning({
          file: CLAUDE_SETTINGS_FILE,
          message: `enabledMcpjsonServers does not include atlas (has: ${has}): Claude asks before using the server - run vulcan project sync`,
        }),
      );
    }

    return warnings;
  }
}
