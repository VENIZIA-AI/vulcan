import { afterAll, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HookConstants, ShellBudget, WriteGuard } from '../../hooks/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { SPAWN_TIMEOUT_MS } from '@venizia/dev-configs/testing';

const FIXTURES = join(import.meta.dir, '..', 'fixtures', 'guard-writes');
const HOOK = join(import.meta.dir, '..', '..', '..', 'base', 'hooks', 'guard-writes.ts');

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

describe('WriteGuard.inspectCommand', () => {
  for (const testCase of CASES) {
    test(`${testCase.flagged ? 'flags' : 'passes'}: ${testCase.name}`, () => {
      const hits = WriteGuard.inspectCommand({
        command: testCase.command,
        cwd: testCase.cwd ?? FIXTURES,
      });

      expect(hits.length > 0).toBe(testCase.flagged);
    });
  }

  test('every hit cites a base rule', () => {
    const hits = WriteGuard.inspectCommand({
      command: 'kubectl apply -f m.yaml && curl -X DELETE https://x.dev/a',
      cwd: FIXTURES,
    });

    expect(hits.map((hit) => hit.rule).sort()).toEqual(['V-W-02', 'V-W-03']);
  });
});

describe('the guard-writes hook', () => {
  const runHook = async (opts: { stdin: string }) => {
    const child = Bun.spawn([process.execPath, HOOK], {
      stdin: new TextEncoder().encode(opts.stdin),
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: SPAWN_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    const stdout = await new Response(child.stdout).text();

    const result = await child.exited;
    return { code: result, stdout: stdout.trim() };
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
    const result = await runHook({ stdin: 'not json' });
    expect(result).toEqual({ code: 0, stdout: '' });
  });
});

describe('the guard-writes hook, on the forms of the commands it covers', () => {
  const DEPLOY = 'kubectl apply -f k8s/\n';
  const MUTATING_JS = "await fetch('https://example.dev/v1/x', { method: 'DELETE' });\n";
  const READING_JS =
    "const response = await fetch('https://example.dev/v1/x');\nconsole.log(response.status);\n";
  const root = createProject({
    files: {
      'deploy.sh': DEPLOY,
      'scripts/deploy': DEPLOY,
      'scripts/mutate': MUTATING_JS,
      'node_modules/.bin/tool': MUTATING_JS,
      'check.sh': 'kubectl get pods\n',
      'mutate.js': MUTATING_JS,
      'mutate.mjs': MUTATING_JS,
      'mutate.cjs': MUTATING_JS,
      'read.js': READING_JS,
      'api.test.ts': `test('x', async () => {\n  ${MUTATING_JS}});\n`,
      'package.json': JSON.stringify({
        name: 'fixture',
        scripts: {
          deploy: 'kubectl apply -f k8s/',
          release: 'bun run deploy',
          ship: 'bash deploy.sh',
          check: 'kubectl get pods',
          loop: 'bun run loop',
          a: 'bun run b',
          b: 'bun run c',
          c: 'bun run d',
          d: 'bun run e',
          e: 'bun run deploy',
        },
      }),
    },
  });

  afterAll(removeProjects);

  const runHook = async (opts: { command: string }) => {
    const child = Bun.spawn([process.execPath, HOOK], {
      cwd: root,
      stdin: new TextEncoder().encode(
        `{"tool_name":"Bash","tool_input":{"command":${JSON.stringify(opts.command)}},"cwd":${JSON.stringify(root)}}`,
      ),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      timeout: SPAWN_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    const result = await new Response(child.stdout).text();
    const stdout = result.trim();

    const code = await child.exited;

    return {
      code,
      decision: stdout === '' ? '' : JSON.parse(stdout).hookSpecificOutput.permissionDecision,
    };
  };

  test.each([
    'kubectl -n prod apply -f x',
    'kubectl --context prod apply -f x',
    'kubectl --namespace=prod delete pod x',
    'kubectl create deployment web --image=nginx',
    'kubectl replace -f x.yaml',
    'kubectl set image deployment/web web=nginx:2',
    'docker compose -f prod.yml up -d',
    'docker --context prod compose up -d',
    'docker-compose up -d',
    'docker-compose -f prod.yml down',
    'helm upgrade --install web ./chart',
    'helm -n prod rollback web 1',
    'helm uninstall web',
    'curl --request POST https://example.dev/v1/x',
    'curl --request=DELETE https://example.dev/v1/x',
    'curl -XPATCH https://example.dev/v1/x',
    "curl -d'{}' https://example.dev/v1/x",
    'curl -d@body.json https://example.dev/v1/x',
    'curl -sd name=x https://example.dev/v1/x',
    "curl --json '{}' https://example.dev/v1/x",
    'curl -T report.csv https://example.dev/v1/x',
    'curl -F file=@report.csv https://example.dev/v1/x',
    'cat migration.sql | psql postgres://localhost/app',
    'cat migration.sql | PGPASSWORD=x psql -h localhost app',
    'psql postgres://localhost/app < migration.sql',
    'psql --file=migration.sql',
    'psql -fmigration.sql',
    'mysql app < dump.sql',
    "mongosh --eval 'db.users.deleteMany({})'",
    'bunx prisma migrate deploy',
    'bash deploy.sh',
    'sh deploy.sh',
    'bash -x deploy.sh',
    'bash deploy.sh -n',
    'bash -euo pipefail deploy.sh',
    'node scripts/mutate',
    './deploy.sh',
    './scripts/deploy',
    'bun mutate.js',
    'bun run mutate.mjs',
    'node mutate.cjs',
    'bun run deploy',
    'bun run release',
    'bun run ship',
    'bun run a',
    `bun -e "await fetch('https://example.dev/v1/x', { method: 'DELETE' })"`,
    `node --eval "await fetch('https://example.dev/v1/x', { method: 'DELETE' })"`,
    "node <<'EOF'\nawait fetch('https://example.dev/v1/x', { method: 'DELETE' });\nEOF",
    'echo "kubectl -n prod apply -f x" | sh',
  ])('asks for %p', async (command) => {
    const result = await runHook({ command });
    expect(result).toEqual({ code: 0, decision: 'ask' });
  });

  test('asks for a command line longer than the shell parser reads', async () => {
    const command = `cat > notes.md <<EOF\n${'x'.repeat(ShellBudget.MAX_CHARS + 1)}\nEOF\nkubectl apply -f x`;

    const result = await runHook({ command });
    expect(result).toEqual({ code: 0, decision: 'ask' });
  });

  test('asks for a local script larger than the guard reads', async () => {
    writeFileSync(
      join(root, 'large.sh'),
      `${'# notes\n'.repeat(HookConstants.MAX_SCRIPT_BYTES / 8 + 1)}`,
    );

    const result = await runHook({ command: 'bash large.sh' });
    expect(result).toEqual({ code: 0, decision: 'ask' });
  });

  test('stays silent for a compiled program run by its path', async () => {
    writeFileSync(
      join(root, 'tool'),
      Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0]), Buffer.from(DEPLOY)]),
    );

    const result = await runHook({ command: './tool --version' });
    expect(result).toEqual({ code: 0, decision: '' });
  });

  test('names the script it read in the reason', () => {
    const [hit] = WriteGuard.inspectCommand({ command: 'bun run release', cwd: root });

    expect(hit?.rule).toBe('V-W-03');
    expect(hit?.message).toContain('bun run release');
    expect(hit?.message).toContain('deploying or hot-applying to a cluster');
  });

  test.each([
    'kubectl get pods -n prod',
    'kubectl -n prod get pods',
    'kubectl auth can-i delete pods',
    'kubectl config set-context dev',
    'docker ps',
    'docker compose ps',
    'docker compose -f up.yml logs',
    'helm list -n prod',
    'helm template web ./chart',
    'curl https://example.dev/v1/x',
    'curl -fsSL https://example.dev/install -o install.txt',
    'curl -I https://example.dev/v1/x',
    "curl -sS -H 'Accept: application/json' https://example.dev/v1/x",
    "psql -c 'SELECT 1'",
    'psql -h localhost -d app -c "select count(*) from users"',
    'psql --version',
    'psql -l',
    "mysql -e 'select 1'",
    "mongosh --eval 'db.users.find()'",
    'bunx prisma migrate status',
    'bun test',
    'bun test api.test.ts',
    'bash -n deploy.sh',
    './node_modules/.bin/tool --version',
    'node node_modules/.bin/tool',
    'bash check.sh',
    './check.sh',
    'bun read.js',
    'bun run check',
    'bun run loop',
    'bun -e "console.log(1)"',
  ])('stays silent for %p', async (command) => {
    const result = await runHook({ command });
    expect(result).toEqual({ code: 0, decision: '' });
  });
});
