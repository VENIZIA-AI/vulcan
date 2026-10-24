/**
 * PreToolUse hook on Write, Edit, MultiEdit, NotebookEdit and Bash: refuses a write to
 * .agents/vulcan.manifest.json. The file is rendered from the config by `vulcan sync`, so a hand
 * edit is either lost on the next sync or hides a config change from the doctor.
 *
 * Unlike guard-writes it denies rather than asks, and it fails closed for the same reason: Claude
 * Code blocks a PreToolUse call only on exit 2, so a hook that throws would let every write through.
 * The modules load inside the try for that reason.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

try {
  const { buildManifestDecision, inspectManifestWrite, parseManifestHookInput } =
    await import('../../src/hooks/guard-manifest.ts');
  const input = parseManifestHookInput({ text: await Bun.stdin.text() });

  if (input && inspectManifestWrite({ input })) {
    console.log(JSON.stringify(buildManifestDecision()));
  }
} catch (error) {
  console.error(
    `vulcan: the guard-manifest hook failed (${error instanceof Error ? error.message : String(error)}) - blocked; run bun install`,
  );
  process.exit(2);
}
