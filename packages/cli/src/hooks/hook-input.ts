import type { IManifestHookInput } from './common/index.ts';

/** The shell tool under the names the hosts give it: Cursor's `Shell`, and a lower-case `bash`. */
const SHELL_NAMES = new Set(['Shell', 'shell', 'bash']);

const BASH_TOOL = 'Bash';

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

const toText = (opts: { value: unknown }): string | undefined =>
  typeof opts.value === 'string' && opts.value !== '' ? opts.value : undefined;

/** The tool name, with the shell tool of another host read as Claude's `Bash`. */
const toolOf = (opts: { value: unknown }): string | undefined => {
  const name = toText(opts);

  return name !== undefined && SHELL_NAMES.has(name) ? BASH_TOOL : name;
};

export class HookInput {
  /** The tool call from the hook's JSON; `undefined` when it is not what Claude Code sends. */
  static parse(opts: { text: string }): IManifestHookInput | undefined {
    let payload: unknown;

    try {
      payload = JSON.parse(opts.text);
    } catch (error) {
      console.error(
        `[HookInput.parse] unreadable hook input | ${error instanceof Error ? error.message : String(error)}`,
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
  }
}
