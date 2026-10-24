/**
 * SubagentStart hook: injects the subagent card (src/hooks/subagent-card.ts) into every subagent as added
 * context: the few rules a subagent must keep, each citing its base rule (V-P-12). It imports only the
 * card - no config, no rules reader, no zod - and it never blocks: any failure prints a note and passes.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

try {
  const { buildSubagentStartOutput } = await import('../../src/hooks/subagent-card.ts');

  console.log(JSON.stringify(buildSubagentStartOutput()));
} catch (error) {
  console.error(
    `vulcan: the subagent-start hook could not build the card (${error instanceof Error ? error.message : String(error)}) - the subagent starts without it`,
  );
}
