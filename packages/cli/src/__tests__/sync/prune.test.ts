import { afterAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { DoctorChecks, runDoctorChecks } from '../../doctor/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const PROJECT = {
  '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'on-user-word' } };\n",
  'AGENTS.md': '# x\n',
  '.agents/hooks/alive.ts': 'console.log("mine");\n',
};

// What a plugin-era setup or an older VULCAN wrote, with no record in sync's managed file.
const OLD_SHIPPED =
  'bun "${CLAUDE_PROJECT_DIR}"/node_modules/@venizia/vulcan/base/hooks/guard-writes.ts';
const DEAD_PLUGIN = 'bun "${CLAUDE_PROJECT_DIR}"/.agents/hooks/session-digest.ts';
const MINE_ALIVE = 'bun "${CLAUDE_PROJECT_DIR}"/.agents/hooks/alive.ts';
const MINE_ELSEWHERE = 'bun "${CLAUDE_PROJECT_DIR}"/tools/gone-but-mine.ts';

const settingsPath = (opts: { root: string }): string =>
  join(opts.root, '.claude', 'settings.json');

const commandsOf = (opts: { root: string }): string[] => {
  const settings: { hooks?: Record<string, { hooks: { command: string }[] }[]> } = JSON.parse(
    readFileSync(settingsPath(opts), 'utf8'),
  );

  return Object.values(settings.hooks ?? {}).flatMap(entries =>
    entries.flatMap(entry => entry.hooks.map(hook => hook.command)),
  );
};

/** A synced project, then the leftovers an old setup would have left beside sync's own entries. */
const projectWithLeftovers = (): string => {
  const root = createProject({ files: PROJECT });

  runCli({ args: ['sync'], cwd: root });

  const settings = JSON.parse(readFileSync(settingsPath({ root }), 'utf8'));
  const entry = (command: string) => ({ hooks: [{ type: 'command', command }] });

  settings.hooks.SessionStart.push(entry(DEAD_PLUGIN), entry(MINE_ALIVE));
  settings.hooks.PreToolUse.push({ matcher: 'Bash', ...entry(OLD_SHIPPED) }, entry(MINE_ELSEWHERE));
  writeFileSync(settingsPath({ root }), `${JSON.stringify(settings, null, 2)}\n`);
  symlinkSync(
    join(root, 'node_modules', '.bun', 'gone', 'skills', 'old-skill'),
    join(root, '.claude', 'skills', 'old-skill'),
  );
  mkdirSync(join(root, '.claude', 'skills', 'hand-made'));

  return root;
};

describe('vulcan sync --prune', () => {
  test('without --prune, nothing it did not write is touched', () => {
    const root = projectWithLeftovers();

    expect(runCli({ args: ['sync'], cwd: root }).code).toBe(0);
    expect(commandsOf({ root })).toContain(OLD_SHIPPED);
    expect(commandsOf({ root })).toContain(DEAD_PLUGIN);
    expect(lstatSync(join(root, '.claude', 'skills', 'old-skill')).isSymbolicLink()).toBe(true);
  });

  test("removes old VULCAN hook commands, dead .agents hooks and dead skill links; a developer's own hooks stay", () => {
    const root = projectWithLeftovers();
    const result = runCli({ args: ['sync', '--prune'], cwd: root });
    const commands = commandsOf({ root });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain(`removed   .claude/settings.json (stale hook: ${OLD_SHIPPED})`);
    expect(result.stderr).toContain(`removed   .claude/settings.json (stale hook: ${DEAD_PLUGIN})`);
    expect(result.stderr).toContain('removed   .claude/skills/old-skill (dead link)');
    expect(commands).not.toContain(OLD_SHIPPED);
    expect(commands).not.toContain(DEAD_PLUGIN);
    expect(commands).toContain(MINE_ALIVE);
    expect(commands).toContain(MINE_ELSEWHERE);
    expect(commands.some(command => command.includes('base/hooks/guard-writes.ts'))).toBe(true);
    expect(existsSync(join(root, '.claude', 'skills', 'old-skill'))).toBe(false);
    expect(lstatSync(join(root, '.claude', 'skills', 'hand-made')).isDirectory()).toBe(true);
    expect(runCli({ args: ['sync', '--prune'], cwd: root }).stderr).not.toContain('removed');
  });

  test("a developer's own .agents hooks elsewhere are never taken for a dead project hook", () => {
    const root = createProject({
      files: { ...PROJECT, 'packages/foo/.agents/hooks/x.ts': 'console.log(1);\n' },
    });

    runCli({ args: ['sync'], cwd: root });

    const mine = [
      'bun packages/foo/.agents/hooks/x.ts',
      'bun "$HOME"/.agents/hooks/personal.ts',
      'cd packages/foo && bun .agents/hooks/x.ts',
    ];
    const settings = JSON.parse(readFileSync(settingsPath({ root }), 'utf8'));

    settings.hooks.Stop = mine.map(command => ({ hooks: [{ type: 'command', command }] }));
    writeFileSync(settingsPath({ root }), `${JSON.stringify(settings, null, 2)}\n`);

    expect(runCli({ args: ['sync', '--prune'], cwd: root }).stderr).not.toContain('removed');
    expect(commandsOf({ root })).toEqual(expect.arrayContaining(mine));
  });

  test('--prune --dry-run prints what it would remove and changes nothing', () => {
    const root = projectWithLeftovers();
    const before = readFileSync(settingsPath({ root }), 'utf8');
    const result = runCli({ args: ['sync', '--prune', '--dry-run'], cwd: root });

    expect(result.stderr).toContain(`(stale hook: ${OLD_SHIPPED})`);
    expect(readFileSync(settingsPath({ root }), 'utf8')).toBe(before);
    expect(lstatSync(join(root, '.claude', 'skills', 'old-skill')).isSymbolicLink()).toBe(true);
  });

  test('doctor reports what --prune would remove, and is clean after it', async () => {
    const root = projectWithLeftovers();
    const before = await runDoctorChecks({ root });

    expect(
      before
        .filter(violation => violation.check === DoctorChecks.PRUNE)
        .map(violation => violation.message),
    ).toEqual([
      `stale hook: ${DEAD_PLUGIN} - run 'bun x --no-install vulcan sync --prune'`,
      `stale hook: ${OLD_SHIPPED} - run 'bun x --no-install vulcan sync --prune'`,
      "dead link - run 'bun x --no-install vulcan sync --prune'",
    ]);

    runCli({ args: ['sync', '--prune'], cwd: root });

    expect(
      (await runDoctorChecks({ root })).filter(violation => violation.check === DoctorChecks.PRUNE),
    ).toEqual([]);
  });
});
