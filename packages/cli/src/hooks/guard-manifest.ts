import { GuardDecisions, HookConstants } from './common/index.ts';
import type { IManifestHookInput } from './common/index.ts';
import { HookDecision } from './decision.ts';
import { GitQuery } from './manifest-git.ts';
import { ManifestPath, PathRef } from './manifest-path.ts';
import { ManifestShell } from './manifest-shell.ts';

/** The shell tool under the names the hosts give it: Cursor's `Shell`, and a lower-case `bash`. */
const SHELL_NAMES = new Set(['Shell', 'shell', 'bash']);

const MANIFEST_BLOCK_MESSAGE =
  'vulcan.manifest.json is generated - edit .configs/vulcan.config.* and run `vulcan sync`';

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

export class ManifestGuard {
  /** The tool call from the hook's JSON; `undefined` when it is not what Claude Code sends. */
  static parseHookInput(opts: { text: string }): IManifestHookInput | undefined {
    let payload: unknown;

    try {
      payload = JSON.parse(opts.text);
    } catch (error) {
      console.error(
        `[ManifestGuard.parseHookInput] unreadable hook input - letting the call through | ${error instanceof Error ? error.message : String(error)}`,
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

  /** Whether this tool call writes `.agents/vulcan.manifest.json` - which only `vulcan sync` may do. */
  static inspectWrite(opts: { input: IManifestHookInput }): boolean {
    const { tool, filePath, command, cwd } = opts.input;

    // What was read of the file system and asked of git belongs to one call.
    GitQuery.begin();
    PathRef.reset();

    if (tool === BASH_TOOL) {
      return (
        command !== undefined &&
        ManifestShell.inspectLine({ line: command, dir: cwd ?? process.cwd(), cwd, depth: 0 })
      );
    }

    return filePath !== undefined && ManifestPath.isWriteTarget({ path: filePath, cwd });
  }

  static buildDecision() {
    return HookDecision.forHost({
      output: {
        hookSpecificOutput: {
          hookEventName: HookConstants.PRE_TOOL_USE,
          permissionDecision: GuardDecisions.DENY,
          permissionDecisionReason: MANIFEST_BLOCK_MESSAGE,
        },
      },
    });
  }
}
