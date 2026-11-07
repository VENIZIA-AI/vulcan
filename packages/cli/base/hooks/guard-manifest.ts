/**
 * PreToolUse hook on Write, Edit, MultiEdit, NotebookEdit and Bash: refuses a write to
 * .agents/vulcan.manifest.json. The file is rendered from the config by `vulcan sync`, so a hand
 * edit is either lost on the next sync or hides a config change from the doctor.
 *
 * Unlike guard-writes it denies rather than asks. Claude Code blocks a PreToolUse call only on exit
 * 2, so the modules load inside the try: a throw (a missing module, a crash) exits 2 and blocks the
 * call. Input that is not a tool call - invalid JSON, empty, null - is not an error: the parser
 * notes it on stderr and the hook exits 0, so the call passes.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

try {
  const { ManifestGuard } = await import('../../src/hooks/guard-manifest.ts');
  const stdin = await Bun.stdin.text();
  const input = ManifestGuard.parseHookInput({ text: stdin });

  if (input && ManifestGuard.inspectWrite({ input })) {
    console.log(JSON.stringify(ManifestGuard.buildDecision()));
  }
} catch (error) {
  console.error(
    `vulcan: the guard-manifest hook failed (${error instanceof Error ? error.message : String(error)}) - blocked; run bun install`,
  );
  process.exit(2);
}
