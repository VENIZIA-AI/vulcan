import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { inspectCommand } from '../hooks/index.ts';

const FIXTURES = join(import.meta.dir, 'fixtures', 'guard-writes');
const HOOK = join(import.meta.dir, '..', '..', 'base', 'hooks', 'guard-writes.ts');

const CASES: { name: string; command: string; cwd?: string; flagged: boolean }[] = [
  { name: 'psql SELECT', command: 'psql -h 127.0.0.1 -c "SELECT 1"', flagged: false },
  { name: 'build a package', command: 'make core inventory', flagged: false },
  { name: 'read-only git', command: 'git status --short', flagged: false },
  { name: 'grep the repo', command: 'grep -rn "POST" packages/inventory/src', flagged: false },
  { name: 'run the test suite', command: 'bun run test', flagged: false },
  { name: 'generate a migration', command: 'bun run db:generate:public:develop', flagged: false },
  { name: 'curl POST', command: 'curl -X POST https://example.dev/v1/api/x', flagged: true },
  {
    name: 'psql UPDATE',
    command: `psql -c 'UPDATE inventory."Stock" SET quantity = 0'`,
    flagged: true,
  },
  {
    name: 'psql -f file.sql',
    command: 'psql -h 127.0.0.1 -U postgres -d app -f repair.sql',
    flagged: true,
  },
  { name: 'kubectl apply', command: 'kubectl apply -f manifest.yaml', flagged: true },
  { name: 'docker compose up', command: 'docker compose up -d', flagged: true },
  { name: 'run a migration', command: 'bun run db:migrate:public:develop', flagged: true },
  {
    name: 'a script whose helper takes the verb',
    command: 'bun mutating-script.ts',
    cwd: FIXTURES,
    flagged: true,
  },
  {
    name: 'a read-only verification script',
    command: 'bun read-only-script.ts',
    cwd: FIXTURES,
    flagged: false,
  },
  {
    name: 'a script that does not exist',
    command: 'bun missing-script.ts',
    cwd: FIXTURES,
    flagged: false,
  },
];

describe('inspectCommand', () => {
  for (const testCase of CASES) {
    test(`${testCase.flagged ? 'flags' : 'passes'}: ${testCase.name}`, () => {
      const hits = inspectCommand({ command: testCase.command, cwd: testCase.cwd ?? FIXTURES });

      expect(hits.length > 0).toBe(testCase.flagged);
    });
  }

  test('every hit cites a base rule', () => {
    const hits = inspectCommand({
      command: 'kubectl apply -f m.yaml && curl -X DELETE https://x.dev/a',
      cwd: FIXTURES,
    });

    expect(hits.map(hit => hit.rule).sort()).toEqual(['V-W-02', 'V-W-03']);
  });
});

describe('the guard-writes hook', () => {
  const runHook = async (opts: { stdin: string }) => {
    const child = Bun.spawn([process.execPath, HOOK], {
      stdin: new TextEncoder().encode(opts.stdin),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(child.stdout).text();

    return { code: await child.exited, stdout: stdout.trim() };
  };

  test('asks the human, naming the rule, for a write', async () => {
    const result = await runHook({
      stdin: '{"tool_name":"Bash","tool_input":{"command":"kubectl apply -f m.yaml"}}',
    });
    const decision = JSON.parse(result.stdout).hookSpecificOutput;

    expect(decision.hookEventName).toBe('PreToolUse');
    expect(decision.permissionDecision).toBe('ask');
    expect(decision.permissionDecisionReason).toContain('V-W-03');
  });

  test('stays silent for a read', async () => {
    const result = await runHook({
      stdin: '{"tool_name":"Bash","tool_input":{"command":"git status"}}',
    });

    expect(result).toEqual({ code: 0, stdout: '' });
  });

  test('stays silent, and never blocks, on input it cannot read', async () => {
    expect(await runHook({ stdin: 'not json' })).toEqual({ code: 0, stdout: '' });
  });
});
