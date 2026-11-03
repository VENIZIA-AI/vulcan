/**
 * SessionStart hook: prints the rules that cost the most when skipped (src/hooks/session-digest.ts).
 * Stdout becomes session context. With `VULCAN_OWNER_REPLY=off` the owner shape and profile cards are left out.
 * It also exports `TMPDIR` (the project's `.agents/local/tmp`) into the file Claude Code sources before each Bash command.
 */
import { ProjectTmp, SessionDigest } from '../../src/hooks/index.ts';

const projectRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

const digest = await SessionDigest.build({ projectRoot });

process.stdout.write(digest);

// Claude Code gives this hook a file it sources before each Bash command: the project's temp folder goes in it.
try {
  ProjectTmp.exportProjectTmp({ root: projectRoot, envFile: process.env.CLAUDE_ENV_FILE });
} catch (error) {
  console.error(
    `vulcan: [session-start] could not make TMPDIR the project's temp folder: ${error}`,
  );
}

// At most once a day, the safe part of .agents/local/ is cleaned by a process of its own: the session does not wait for it.
try {
  const { LocalAutoClean } = await import('../../src/local/auto-clean.ts');
  const note = LocalAutoClean.tick({ root: projectRoot });

  if (note !== undefined) {
    console.error(note);
  }
} catch (error) {
  console.error(`vulcan: [session-start] the automatic clean was skipped: ${error}`);
}
