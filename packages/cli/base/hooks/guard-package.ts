/**
 * PreToolUse hook on Write: a new package.json inside a backend, frontend or shared folder is the
 * start of a hand-made app or library. When the project recorded a preset that makes it, the call
 * is denied with the exact `vulcan add` command; with no preset behind the folder it only adds a
 * note, because a block with no command to offer would leave the agent stuck.
 *
 * Reads only the generated manifest; an existing file, node_modules, or a folder outside the
 * layout passes silently. It fails closed like the other guards: Claude Code blocks a PreToolUse
 * call only on exit 2, so the modules load inside the try.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

try {
  const { buildPackageDecision, inspectPackageWrite, parseManifestHookInput } =
    await import('../../src/hooks/index.ts');
  const input = parseManifestHookInput({ text: await Bun.stdin.text() });
  const verdict = input && inspectPackageWrite({ input });

  if (verdict) {
    console.log(JSON.stringify(buildPackageDecision({ verdict })));
  }
} catch (error) {
  console.error(
    `vulcan: the guard-package hook failed (${error instanceof Error ? error.message : String(error)}) - blocked; run bun install`,
  );
  process.exit(2);
}
