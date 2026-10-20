import { join } from 'node:path';

export const CODEX_BLOCK_START = '# vulcan:atlas:start';
export const CODEX_BLOCK_END = '# vulcan:atlas:end';
const CODEX_TABLE = '[mcp_servers.atlas]';
const SERVER_NAME = 'atlas';

export type TMergeResult =
  | { ok: true; changed: boolean; text: string }
  | { ok: false; reason: string };

/**
 * The atlas server as a per-machine file starts it: the project's own `vulcan` by absolute path with
 * an absolute `--root`, so it does not matter which directory the agent launches the server from.
 */
export const atlasServerEntry = (opts: { root: string }): { command: string; args: string[] } => ({
  command: 'bun',
  args: [
    join(opts.root, 'node_modules', '.bin', 'vulcan'),
    'x',
    'atlas',
    'mcp',
    '--root',
    opts.root,
  ],
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Sets the `atlas` server in a JSON file's server map and nothing else: the user's keys, servers and
 * order stay, and an `atlas` entry that is already there is the user's and is left as it is.
 */
export const mergeMcpServers = (opts: {
  text: string | undefined;
  key: string;
  entry: Record<string, unknown>;
}): TMergeResult => {
  let document: Record<string, unknown> = {};

  if (opts.text !== undefined) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(opts.text);
    } catch {
      return { ok: false, reason: 'not valid JSON' };
    }

    if (!isRecord(parsed)) {
      return { ok: false, reason: 'not a JSON object' };
    }

    document = parsed;
  }

  const servers = document[opts.key] ?? {};

  if (!isRecord(servers)) {
    return { ok: false, reason: `${opts.key} is not an object` };
  }

  if (Object.hasOwn(servers, SERVER_NAME)) {
    return { ok: true, changed: false, text: opts.text ?? '' };
  }

  const text = `${JSON.stringify(
    { ...document, [opts.key]: { ...servers, [SERVER_NAME]: opts.entry } },
    null,
    2,
  )}\n`;

  return { ok: true, changed: true, text };
};

const codexBlock = (opts: { root: string }): string => {
  const { command, args } = atlasServerEntry({ root: opts.root });

  return [
    CODEX_BLOCK_START,
    CODEX_TABLE,
    `command = ${JSON.stringify(command)}`,
    `args = [${args.map(arg => JSON.stringify(arg)).join(', ')}]`,
    CODEX_BLOCK_END,
    '',
  ].join('\n');
};

/**
 * The atlas entry as a marker-delimited block of `.codex/config.toml`: no TOML writer is needed, and
 * a later sync replaces only what sits between the markers.
 */
export const mergeCodexToml = (opts: { text: string | undefined; root: string }): TMergeResult => {
  const block = codexBlock({ root: opts.root });

  if (opts.text === undefined || opts.text === '') {
    return { ok: true, changed: true, text: block };
  }

  const start = opts.text.indexOf(CODEX_BLOCK_START);
  const end = opts.text.indexOf(CODEX_BLOCK_END);

  if (start !== -1 && end > start) {
    const after = end + CODEX_BLOCK_END.length;
    const rest = opts.text.slice(after).replace(/^\n/, '');
    const text = `${opts.text.slice(0, start)}${block}${rest}`;

    return { ok: true, changed: text !== opts.text, text };
  }

  if (opts.text.includes(CODEX_TABLE)) {
    return {
      ok: false,
      reason: 'a [mcp_servers.atlas] table is already there outside the vulcan markers',
    };
  }

  return {
    ok: true,
    changed: true,
    text: `${opts.text}${opts.text.endsWith('\n') ? '' : '\n'}\n${block}`,
  };
};
