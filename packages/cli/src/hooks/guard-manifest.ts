import { isAbsolute, join, normalize } from 'node:path';
import { GuardDecisions, HookConstants } from './common/index.ts';
import type { IManifestHookInput } from './common/index.ts';
import { forHost } from './decision.ts';

/** The shell tool under the names the hosts give it: Cursor's `Shell`, and a lower-case `bash`. */
const SHELL_NAMES = new Set(['Shell', 'shell', 'bash']);

export const MANIFEST_BLOCK_MESSAGE =
  'vulcan.manifest.json is generated - edit .configs/vulcan.config.* and run `vulcan sync`';

const MANIFEST_SUFFIX = '/.agents/vulcan.manifest.json';
const BASH_TOOL = 'Bash';
/** A path word that ends in the manifest's name. */
const TARGET = String.raw`[^\s;|&<>"']*vulcan\.manifest\.json`;

/** The shell forms that write, replace or delete a file; reading it (cat, jq, git diff) is not among them. */
const WRITE_PATTERNS: RegExp[] = [
  // `> file`, `>> file`, `2> file`, `&> file`, `>| file`
  new RegExp(String.raw`(?:^|[^<>])\d?>>?\|?\s*["']?${TARGET}`),
  new RegExp(String.raw`\btee\b[^;|&]*${TARGET}`),
  new RegExp(
    String.raw`\b(?:sed|perl|ruby)\b[^;|&]*\s(?:-[A-Za-z]*i\b|--in-place)[^;|&]*${TARGET}`,
  ),
  // the manifest as the destination: the last argument
  new RegExp(String.raw`\b(?:cp|mv|install|ln)\b[^;|&]*\s["']?${TARGET}["']?\s*(?:$|[;|&])`),
  new RegExp(String.raw`\bof=["']?${TARGET}`),
  new RegExp(String.raw`\b(?:rm|truncate|shred|unlink)\b[^;|&]*${TARGET}`),
];

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

const toText = (opts: { value: unknown }): string | undefined =>
  typeof opts.value === 'string' && opts.value !== '' ? opts.value : undefined;

/** The tool name, with the shell tool of another host read as Claude's `Bash`. */
const toolOf = (opts: { value: unknown }): string | undefined => {
  const name = toText(opts);

  return name !== undefined && SHELL_NAMES.has(name) ? BASH_TOOL : name;
};

/** The tool call from the hook's JSON; `undefined` when it is not what Claude Code sends. */
export const parseManifestHookInput = (opts: { text: string }): IManifestHookInput | undefined => {
  let payload: unknown;

  try {
    payload = JSON.parse(opts.text);
  } catch (error) {
    console.error(
      `[parseManifestHookInput] unreadable hook input - letting the call through | ${error instanceof Error ? error.message : String(error)}`,
    );

    return undefined;
  }

  const holder = { value: payload };

  if (!isRecord(holder)) {
    return undefined;
  }

  // The wire names are snake_case; they stay behind string-literal access here, at the boundary (V-C-14).
  const toolInput = { value: holder.value['tool_input'] };
  const input = isRecord(toolInput) ? toolInput.value : {};
  const tool = toolOf({ value: holder.value['tool_name'] });

  return tool === undefined
    ? undefined
    : {
        tool,
        filePath:
          toText({ value: input['file_path'] }) ?? toText({ value: input['notebook_path'] }),
        command: toText({ value: input['command'] }),
        cwd: toText({ value: holder.value['cwd'] }),
      };
};

/** Whether this tool call writes `.agents/vulcan.manifest.json` - which only `vulcan sync` may do. */
export const inspectManifestWrite = (opts: { input: IManifestHookInput }): boolean => {
  const { tool, filePath, command, cwd } = opts.input;

  if (tool === BASH_TOOL) {
    return command !== undefined && WRITE_PATTERNS.some((pattern) => pattern.test(command));
  }

  if (filePath === undefined) {
    return false;
  }

  const absolute = isAbsolute(filePath) ? filePath : join(cwd ?? process.cwd(), filePath);

  return normalize(absolute).endsWith(MANIFEST_SUFFIX);
};

export const buildManifestDecision = () =>
  forHost({
    output: {
      hookSpecificOutput: {
        hookEventName: HookConstants.PRE_TOOL_USE,
        permissionDecision: GuardDecisions.DENY,
        permissionDecisionReason: MANIFEST_BLOCK_MESSAGE,
      },
    },
  });
