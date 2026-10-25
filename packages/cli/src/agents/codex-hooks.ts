import { RemoveOutcomes } from './common/index.ts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The script every VULCAN entry runs: it is how an entry of ours is told from a hook of the user's. */
const GUARD_SCRIPT = 'codex-guards.ts';

const DENY_ON_CRASH = JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason:
      'The VULCAN guard crashed, so this call was not checked. Codex cannot ask: a human must confirm it; VULCAN_GUARDS=off switches the guards off for a session.',
  },
});

/**
 * The hook command. Codex runs it from the session's folder, which may be below the project, so the project
 * is the git top level. A missing package or bun passes with a note; a script that started and crashed
 * denies, because Codex cannot ask.
 */
const GUARD_COMMAND = [
  'd=$(git rev-parse --show-toplevel 2>/dev/null || pwd);',
  `f="$d/node_modules/@venizia/vulcan/base/hooks/${GUARD_SCRIPT}";`,
  'if [ -f "$f" ] && command -v bun >/dev/null 2>&1; then',
  'in=$(cat); out=$(printf \'%s\' "$in" | bun "$f"); s=$?;',
  `if [ "$s" -eq 0 ]; then printf '%s' "$out"; exit 0; fi;`,
  `printf '%s\\n' '${DENY_ON_CRASH}'; exit 0; fi;`,
  'cat >/dev/null; echo "vulcan: the guards cannot run: node_modules/@venizia/vulcan or bun is missing - the call passes" >&2',
].join(' ');

/** What the entry holds: one hook on the shell and the patch tool. */
const guardEntry = (): Record<string, unknown> => ({
  matcher: 'Bash|apply_patch',
  hooks: [{ type: 'command', command: GUARD_COMMAND, timeout: 60, statusMessage: 'VULCAN guards' }],
});

const isGuardEntry = (entry: unknown): boolean =>
  isRecord(entry) &&
  Array.isArray(entry.hooks) &&
  entry.hooks.some(
    (hook) =>
      isRecord(hook) && typeof hook.command === 'string' && hook.command.includes(GUARD_SCRIPT),
  );

interface IParsedFile {
  file: Record<string, unknown>;
  hooks: Record<string, unknown>;
  entries: unknown[];
}

const parseFile = (opts: { text: string | undefined }): IParsedFile | { reason: string } => {
  if (opts.text === undefined || opts.text.trim() === '') {
    return { file: {}, hooks: {}, entries: [] };
  }

  try {
    const file: unknown = JSON.parse(opts.text);

    if (!isRecord(file)) {
      return { reason: 'the hooks file is not a JSON object' };
    }

    const hooks = file.hooks === undefined ? {} : file.hooks;
    const entries = isRecord(hooks) && hooks.PreToolUse !== undefined ? hooks.PreToolUse : [];

    return isRecord(hooks) && Array.isArray(entries)
      ? { file, hooks, entries }
      : { reason: 'the hooks file has a hooks or PreToolUse value that is not what Codex reads' };
  } catch (error) {
    return {
      reason: `the hooks file is not JSON (${error instanceof Error ? error.message : String(error)})`,
    };
  }
};

export type TCodexHooksMerge =
  | { ok: true; changed: boolean; text: string }
  | { ok: false; reason: string };

/** The hooks file with VULCAN's PreToolUse entry in it, every other entry as the user wrote it. */
export const mergeCodexHooks = (opts: { text: string | undefined }): TCodexHooksMerge => {
  const parsed = parseFile({ text: opts.text });

  if ('reason' in parsed) {
    return { ok: false, reason: parsed.reason };
  }

  const entry = guardEntry();
  const index = parsed.entries.findIndex((item) => isGuardEntry(item));
  const changed = index === -1 || JSON.stringify(parsed.entries[index]) !== JSON.stringify(entry);
  const entries =
    index === -1
      ? [...parsed.entries, entry]
      : parsed.entries.map((item, at) => (at === index ? entry : item));

  return {
    ok: true,
    changed,
    text: `${JSON.stringify({ ...parsed.file, hooks: { ...parsed.hooks, PreToolUse: entries } }, null, 2)}\n`,
  };
};

export type TCodexHooksRemoval =
  | { ok: true; outcome: typeof RemoveOutcomes.ABSENT }
  | { ok: true; outcome: typeof RemoveOutcomes.REMOVED; text: string | undefined }
  | { ok: false; reason: string };

/** The hooks file without VULCAN's entry; `text` is undefined when nothing else was in it. */
export const removeCodexHooks = (opts: { text: string }): TCodexHooksRemoval => {
  const parsed = parseFile({ text: opts.text });

  if ('reason' in parsed) {
    return { ok: false, reason: parsed.reason };
  }

  if (!parsed.entries.some((item) => isGuardEntry(item))) {
    return { ok: true, outcome: RemoveOutcomes.ABSENT };
  }

  const kept = parsed.entries.filter((item) => !isGuardEntry(item));
  const { PreToolUse: _removed, ...otherEvents } = parsed.hooks;
  const hooks = kept.length > 0 ? { ...otherEvents, PreToolUse: kept } : otherEvents;
  const { hooks: _hooks, ...otherKeys } = parsed.file;
  const file = Object.keys(hooks).length > 0 ? { ...otherKeys, hooks } : otherKeys;

  return {
    ok: true,
    outcome: RemoveOutcomes.REMOVED,
    text: Object.keys(file).length === 0 ? undefined : `${JSON.stringify(file, null, 2)}\n`,
  };
};
