import { RemoveOutcomes } from './common/index.ts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The key of VULCAN's entry in Antigravity's hooks file: the file maps a hook name to its events. */
export const GUARD_HOOK_NAME = 'vulcan-guards';

/** The Antigravity tools the guards cover, as a matcher (a regular expression over the tool name). */
const GUARD_MATCHER = 'run_command|write_to_file|replace_file_content|multi_replace_file_content';

const ASK_ON_CRASH = JSON.stringify({
  decision: 'ask',
  reason:
    'The VULCAN guard crashed, so this call was not checked. Confirm only if the owner asked for exactly this; VULCAN_GUARDS=off switches the guards off for a session.',
});

/**
 * The hook command. Antigravity runs it from the folder of the hooks file (`.agents`), so the install is
 * `../node_modules`. A missing package or bun passes with a note; a script that started and crashed asks.
 */
const GUARD_COMMAND = [
  'f="$PWD/../node_modules/@venizia/vulcan/base/hooks/antigravity-guards.ts";',
  'if [ -f "$f" ] && command -v bun >/dev/null 2>&1; then',
  'in=$(cat); out=$(printf \'%s\' "$in" | bun "$f"); s=$?;',
  `if [ "$s" -eq 0 ]; then printf '%s' "$out"; exit 0; fi;`,
  `printf '%s\\n' '${ASK_ON_CRASH}'; exit 0; fi;`,
  'cat >/dev/null; echo "vulcan: the guards cannot run: node_modules/@venizia/vulcan or bun is missing - the call passes" >&2;',
  `printf '%s\\n' '{"decision":"allow"}'`,
].join(' ');

/** What the entry holds: one PreToolUse hook on the tools the guards cover. */
const guardEntry = (): Record<string, unknown> => ({
  PreToolUse: [
    {
      matcher: GUARD_MATCHER,
      hooks: [{ type: 'command', command: GUARD_COMMAND, timeout: 60 }],
    },
  ],
});

type TParsedHooks = { ok: true; hooks: Record<string, unknown> } | { ok: false; reason: string };

const parseHooks = (opts: { text: string | undefined }): TParsedHooks => {
  if (opts.text === undefined || opts.text.trim() === '') {
    return { ok: true, hooks: {} };
  }

  try {
    const parsed: unknown = JSON.parse(opts.text);

    return isRecord(parsed)
      ? { ok: true, hooks: parsed }
      : { ok: false, reason: 'the hooks file is not a JSON object' };
  } catch (error) {
    return {
      ok: false,
      reason: `the hooks file is not JSON (${error instanceof Error ? error.message : String(error)})`,
    };
  }
};

export type THooksMerge =
  | { ok: true; changed: boolean; text: string }
  | { ok: false; reason: string };

/** The hooks file with VULCAN's entry in it, every other hook as the user wrote it. */
export const mergeGuardHook = (opts: { text: string | undefined }): THooksMerge => {
  const parsed = parseHooks({ text: opts.text });

  if (!parsed.ok) {
    return parsed;
  }

  const entry = guardEntry();
  const changed = JSON.stringify(parsed.hooks[GUARD_HOOK_NAME]) !== JSON.stringify(entry);

  return {
    ok: true,
    changed,
    text: `${JSON.stringify({ ...parsed.hooks, [GUARD_HOOK_NAME]: entry }, null, 2)}\n`,
  };
};

export type THooksRemoval =
  | { ok: true; outcome: typeof RemoveOutcomes.ABSENT }
  | { ok: true; outcome: typeof RemoveOutcomes.REMOVED; text: string | undefined }
  | { ok: false; reason: string };

/** The hooks file without VULCAN's entry; `text` is undefined when nothing else was in it. */
export const removeGuardHook = (opts: { text: string }): THooksRemoval => {
  const parsed = parseHooks({ text: opts.text });

  if (!parsed.ok) {
    return parsed;
  }

  if (!Object.hasOwn(parsed.hooks, GUARD_HOOK_NAME)) {
    return { ok: true, outcome: RemoveOutcomes.ABSENT };
  }

  const others = Object.fromEntries(
    Object.entries(parsed.hooks).filter(([name]) => name !== GUARD_HOOK_NAME),
  );

  return {
    ok: true,
    outcome: RemoveOutcomes.REMOVED,
    text: Object.keys(others).length === 0 ? undefined : `${JSON.stringify(others, null, 2)}\n`,
  };
};
