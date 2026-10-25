import { HookConstants } from './common/index.ts';
import { basenameOf, parseShell, programOf } from './shell.ts';

/** `python`, `python3`, `python3.12`, `pip`, `pip3`: the program a command runs, not a word it mentions. */
const SCRIPTING_PROGRAM = /^(?:python\d*(?:\.\d+)?|pip\d*(?:\.\d+)?)$/;

/** One line, worded like the rule: a preference, never a ban. */
export const SCRIPTING_ADVICE =
  'V-B-09: agent scripting uses bun by default (bun -e, bun file.ts, Bun.file()). Python or another language is fine when the task needs it (an existing project script, a tool only that language has); say so in one line when you use it.';

/** `command -v python3` asks whether a program exists; it does not run it. */
const isExistenceProbe = (opts: { words: string[] }): boolean => {
  const at = opts.words.indexOf('command');

  return at !== -1 && ['-v', '-V'].includes(opts.words[at + 1] ?? '');
};

/** The scripting programs a command runs, in order: a mention in an argument, a message, a heredoc or an existence probe is not one. */
export const inspectScripting = (opts: { command: string }): string[] =>
  parseShell({ command: opts.command })
    .filter((command) => !isExistenceProbe({ words: command.words }))
    .map((command) => basenameOf({ word: programOf({ command }).name }))
    .filter((name) => SCRIPTING_PROGRAM.test(name));

/** The PreToolUse answer that adds the advice to the model's context and lets the call through. */
export const buildScriptingAdvice = () => ({
  hookSpecificOutput: {
    hookEventName: HookConstants.PRE_TOOL_USE,
    additionalContext: SCRIPTING_ADVICE,
  },
});
