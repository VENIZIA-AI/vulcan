/**
 * SessionStart hook: prints the rules that cost the most when skipped (src/hooks/session-digest.ts).
 * Stdout becomes session context. With `VULCAN_OWNER_REPLY=off` the owner shape and profile cards are left out.
 * It also exports `TMPDIR` (the project's `.agents/local/tmp`) into the file Claude Code sources before each Bash command.
 */
import { buildSessionDigest, exportProjectTmp } from '../../src/hooks/index.ts';

const projectRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

process.stdout.write(await buildSessionDigest({ projectRoot }));

// Claude Code gives this hook a file it sources before each Bash command: the project's temp folder goes in it.
try {
  exportProjectTmp({ root: projectRoot, envFile: process.env.CLAUDE_ENV_FILE });
} catch (error) {
  console.error(
    `vulcan: [session-start] could not make TMPDIR the project's temp folder: ${error}`,
  );
}
