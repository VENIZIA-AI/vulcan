/**
 * SubagentStart hook: injects the compact rules digest into every subagent as added context
 * (src/hooks/session-digest.ts), so a subagent starts with the write boundaries and the rules sessions
 * drop most (V-P-12). It never blocks: any failure prints a note and passes.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

try {
  const { buildSubagentStartOutput } = await import('../../src/hooks/index.ts');

  console.log(
    JSON.stringify(
      await buildSubagentStartOutput({
        projectRoot: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
      }),
    ),
  );
} catch (error) {
  console.error(
    `vulcan: the subagent-start hook could not build the digest (${error instanceof Error ? error.message : String(error)}) - the subagent starts without it`,
  );
}
