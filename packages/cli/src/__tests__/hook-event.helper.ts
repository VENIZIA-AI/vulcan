/**
 * A PreToolUse event as Claude Code sends it: its own snake_case keys, written through string keys (V-C-14), as a string for a
 * hook's stdin.
 */
export const toolEvent = (opts: {
  tool: string;
  input: Record<string, unknown>;
  cwd: string;
}): string =>
  JSON.stringify(
    Object.fromEntries([
      ['tool_name', opts.tool],
      ['tool_input', opts.input],
      ['cwd', opts.cwd],
    ]),
  );

/** The event of a file tool: `NotebookEdit` names its file `notebook_path`, the others `file_path`. */
export const fileToolEvent = (opts: { tool: string; path: string; cwd: string }): string =>
  toolEvent({
    tool: opts.tool,
    input: Object.fromEntries([
      [opts.tool === 'NotebookEdit' ? 'notebook_path' : 'file_path', opts.path],
    ]),
    cwd: opts.cwd,
  });
