/**
 * The automatic clean of `.agents/local/`, started detached by the session-start hook at most once a day
 * (src/local/auto-clean.ts). It removes the safe part only (src/local/auto-clean-run.ts) and writes a stamp with what went.
 * It fails open: nothing waits for it, and an error is a line on a stderr nobody reads.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

try {
  const root = process.argv[2];

  if (root !== undefined && root !== '') {
    const { AutoCleanRun } = await import('../../src/local/auto-clean-run.ts');

    AutoCleanRun.run({ root });
  }
} catch (error) {
  console.error(
    `vulcan: the automatic clean failed (${error instanceof Error ? error.message : String(error)})`,
  );
}
