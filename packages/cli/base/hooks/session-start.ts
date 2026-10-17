/**
 * SessionStart hook: prints the rules that cost the most when skipped (src/hooks/session-digest.ts).
 * Stdout becomes session context.
 */
import { buildSessionDigest } from '../../src/hooks/index.ts';

process.stdout.write(
  await buildSessionDigest({ projectRoot: process.env.CLAUDE_PROJECT_DIR ?? process.cwd() }),
);
