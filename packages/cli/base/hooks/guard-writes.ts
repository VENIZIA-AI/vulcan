/**
 * PreToolUse hook on Bash: catches the writes V-W-02 and V-W-03 reserve for a human, reading the
 * command and any local script it runs. It asks rather than denies (src/hooks/common/constants.ts).
 */
import { buildGuardDecision, inspectCommand, parseHookCommand } from '../../src/hooks/index.ts';

const hookCommand = parseHookCommand({ text: await Bun.stdin.text() });
const hits = hookCommand
  ? inspectCommand({ command: hookCommand.command, cwd: hookCommand.cwd ?? process.cwd() })
  : [];

if (hits.length > 0) {
  console.log(JSON.stringify(buildGuardDecision({ hits })));
}
