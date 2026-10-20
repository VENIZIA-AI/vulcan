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
 * Whether an `atlas` entry is the one sync writes, for whatever place: `bun <root>/node_modules/.bin/vulcan
 * x atlas mcp --root <root>` (plus `type: stdio` for VS Code) with the two paths agreeing. Anything else
 * is the user's. A project that moved is recognised this way and rewritten.
 */
const isOwnEntry = (opts: { entry: unknown }): boolean => {
  const { entry } = opts;

  if (!isRecord(entry) || entry.command !== 'bun' || !Array.isArray(entry.args)) {
    return false;
  }

  const keys = Object.keys(entry).filter(key => key !== 'type');
  const [bin, ...rest] = entry.args;
  const root = rest[4];

  return (
    keys.length === 2 &&
    (entry.type === undefined || entry.type === 'stdio') &&
    entry.args.length === 6 &&
    rest.slice(0, 4).join(' ') === 'x atlas mcp --root' &&
    typeof root === 'string' &&
    bin === join(root, 'node_modules', '.bin', 'vulcan')
  );
};

/**
 * Sets the `atlas` server in a JSON file's server map and nothing else: the user's keys, servers and
 * order stay, an `atlas` entry sync wrote for another place is rewritten for this one, and any other
 * `atlas` entry is the user's and is left as it is.
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

  const existing = servers[SERVER_NAME];

  if (Object.hasOwn(servers, SERVER_NAME) && !isOwnEntry({ entry: existing })) {
    return { ok: true, changed: false, text: opts.text ?? '' };
  }

  if (
    Object.hasOwn(servers, SERVER_NAME) &&
    JSON.stringify(existing) === JSON.stringify(opts.entry)
  ) {
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

export type TRemoveResult =
  | { ok: true; outcome: 'absent' }
  | { ok: true; outcome: 'removed'; text: string | undefined }
  | { ok: false; reason: string };

/**
 * Takes sync's own atlas entry out of a JSON server map. The file is deleted (`text` undefined) when
 * nothing else is left in it; an entry of another shape is the user's and is reported, not removed.
 */
export const removeMcpEntry = (opts: { text: string; key: string }): TRemoveResult => {
  let document: unknown;

  try {
    document = JSON.parse(opts.text);
  } catch {
    return { ok: false, reason: 'not valid JSON - left untouched' };
  }

  if (!isRecord(document)) {
    return { ok: false, reason: 'not a JSON object - left untouched' };
  }

  const servers = document[opts.key];

  if (!isRecord(servers) || !Object.hasOwn(servers, SERVER_NAME)) {
    return { ok: true, outcome: 'absent' };
  }

  if (!isOwnEntry({ entry: servers[SERVER_NAME] })) {
    return { ok: false, reason: 'the atlas entry is not the one sync wrote - left alone' };
  }

  const otherServers = Object.fromEntries(
    Object.entries(servers).filter(([name]) => name !== SERVER_NAME),
  );
  const otherKeys = Object.fromEntries(
    Object.entries(document).filter(([key]) => key !== opts.key),
  );
  const remaining =
    Object.keys(otherServers).length === 0 ? otherKeys : { ...document, [opts.key]: otherServers };
  const onlyEmptyInputs = Object.entries(remaining).every(
    ([key, value]) => key === 'inputs' && Array.isArray(value) && value.length === 0,
  );

  return {
    ok: true,
    outcome: 'removed',
    text: onlyEmptyInputs ? undefined : `${JSON.stringify(remaining, null, 2)}\n`,
  };
};

/** Takes the marker block out of `.codex/config.toml`; `text` is undefined when nothing else is left. */
export const removeCodexBlock = (opts: {
  text: string;
}): { changed: boolean; text: string | undefined } => {
  const start = opts.text.indexOf(CODEX_BLOCK_START);
  const end = opts.text.indexOf(CODEX_BLOCK_END);

  if (start === -1 || end < start) {
    return { changed: false, text: opts.text };
  }

  const before = opts.text.slice(0, start).replace(/\n+$/, '\n');
  const after = opts.text.slice(end + CODEX_BLOCK_END.length).replace(/^\n+/, '');
  const text = `${before}${before !== '' && after !== '' ? '\n' : ''}${after}`;

  return { changed: true, text: text.trim() === '' ? undefined : text };
};
