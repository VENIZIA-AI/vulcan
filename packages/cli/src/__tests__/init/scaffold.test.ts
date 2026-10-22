import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeCommand } from '../fake-command.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const STYLED_PACKAGE =
  '{ "name": "demo", "devDependencies": { "@venizia/dev-configs": "0.3.1-0" } }';

/** Tests never run a real install. */
const NO_INSTALL = { VULCAN_NO_INSTALL: '1' };

const SCAFFOLD = [
  'AGENTS.md',
  '.configs/vulcan.config.mts',
  '.configs/lints/oxlint.config.mts',
  '.configs/lints/eslint.config.mjs',
  '.configs/formatters/oxfmt.config.mts',
  '.agents/rules.md',
  '.agents/knowledge/index.md',
  'Makefile',
];

describe('vulcan init', () => {
  test('an empty project gets the whole layer, mts config by default', () => {
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE } });

    expect(runCli({ args: ['init'], cwd: root, env: NO_INSTALL }).code).toBe(0);

    for (const path of SCAFFOLD) {
      expect(existsSync(join(root, path))).toBe(true);
    }

    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('How to work in demo');
    expect(readFileSync(join(root, 'Makefile'), 'utf8')).toContain(
      'include node_modules/@venizia/vulcan/base/make/vulcan.mk',
    );
    expect(readFileSync(join(root, '.configs/lints/oxlint.config.mts'), 'utf8')).toContain(
      '@venizia/dev-configs',
    );
  });

  test('a root .dockerignore is created when there is none, and reported', () => {
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE } });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    expect(result.stderr).toContain('created  .dockerignore');

    const lines = readFileSync(join(root, '.dockerignore'), 'utf8').split('\n');

    expect(lines).toContain('**/node_modules');
    expect(lines).toContain('.git');
    expect(lines).toContain('.cursor/mcp.json');
    expect(lines).not.toContain('bun.lock');

    const secrets = ['**/.env', '**/.env.*', '!**/.env.example'].map(line => lines.indexOf(line));

    expect(secrets.every(index => index > 0)).toBe(true);
    expect(secrets).toEqual([...secrets].sort((a, b) => a - b));
  });

  test('a root bunfig.toml with telemetry off is created when there is none, and reported', () => {
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE } });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });
    const text = readFileSync(join(root, 'bunfig.toml'), 'utf8');

    expect(result.stderr).toContain('created  bunfig.toml');
    expect(text.split('\n')).toContain('telemetry = false');
    expect(text).toContain('only from the directory');
    // No release-age gate: it fails a fresh install whose floors are the latest versions.
    expect(text).not.toContain('minimumReleaseAge');
  });

  test('an existing bunfig.toml is kept byte for byte and reported, and sync leaves it alone', () => {
    const root = createProject({
      files: { 'package.json': STYLED_PACKAGE, 'bunfig.toml': '[install]\nexact = true\n' },
    });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    expect(result.stderr).toContain('kept     bunfig.toml');
    expect(readFileSync(join(root, 'bunfig.toml'), 'utf8')).toBe('[install]\nexact = true\n');

    runCli({ args: ['sync', '--agents', 'omp'], cwd: root, env: NO_INSTALL });

    expect(readFileSync(join(root, 'bunfig.toml'), 'utf8')).toBe('[install]\nexact = true\n');
  });

  test('an existing .dockerignore is kept byte for byte and reported', () => {
    const root = createProject({
      files: { 'package.json': STYLED_PACKAGE, '.dockerignore': 'mine\n' },
    });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    expect(result.stderr).toContain('kept     .dockerignore');
    expect(readFileSync(join(root, '.dockerignore'), 'utf8')).toBe('mine\n');
  });

  for (const extension of ['ts', 'mjs', 'js']) {
    test(`--config ${extension} writes that format only`, () => {
      const root = createProject({ files: { 'package.json': STYLED_PACKAGE } });

      runCli({ args: ['init', '--config', extension], cwd: root, env: NO_INSTALL });
      expect(existsSync(join(root, `.configs/vulcan.config.${extension}`))).toBe(true);
      expect(existsSync(join(root, '.configs/vulcan.config.mts'))).toBe(false);
    });
  }

  test('an unknown --config value exits 1 and writes nothing', () => {
    const root = createProject({ files: {} });

    expect(runCli({ args: ['init', '--config', 'yaml'], cwd: root, env: NO_INSTALL }).code).toBe(1);
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false);
  });

  test('never overwrites: existing files are kept, and the missing include is printed', () => {
    const root = createProject({
      files: {
        'package.json': STYLED_PACKAGE,
        'AGENTS.md': '# mine\n',
        Makefile: 'build:\n\t@echo\n',
      },
    });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe('# mine\n');
    expect(readFileSync(join(root, 'Makefile'), 'utf8')).toBe('build:\n\t@echo\n');
    expect(result.stderr).toContain('include node_modules/@venizia/vulcan/base/make/vulcan.mk');
  });

  test('an existing config of another format is kept; no second config appears', () => {
    const root = createProject({ files: { '.configs/vulcan.config.mjs': 'export default {};\n' } });

    runCli({ args: ['init'], cwd: root, env: NO_INSTALL });
    expect(existsSync(join(root, '.configs/vulcan.config.mts'))).toBe(false);
  });

  test('missing .gitignore entries are written, existing lines kept', () => {
    const root = createProject({
      files: { '.gitignore': 'node_modules/\n', 'package.json': STYLED_PACKAGE },
    });

    runCli({ args: ['init'], cwd: root, env: NO_INSTALL });
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(
      'node_modules/\nCLAUDE.md\nCLAUDE.*.md\n.claude/\n.agents/plans\n.agents/vulcan.local.json\n',
    );
  });

  test('a .gitignore without a final newline gets one before the new lines', () => {
    const root = createProject({
      files: { '.gitignore': 'node_modules/', 'package.json': STYLED_PACKAGE },
    });

    runCli({ args: ['init'], cwd: root, env: NO_INSTALL });
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(
      'node_modules/\nCLAUDE.md\nCLAUDE.*.md\n.claude/\n.agents/plans\n.agents/vulcan.local.json\n',
    );
  });

  test('lint tools the scaffolded configs need are installed when undeclared', () => {
    const root = createProject({ files: { 'package.json': '{ "name": "demo" }' } });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    expect(result.stderr).toContain(
      'skipped  bun add -d --exact oxlint oxlint-tsgolint oxfmt eslint @venizia/dev-configs',
    );
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe('{ "name": "demo" }');
  });

  test('the packages to install are listed before the install runs', () => {
    const root = createProject({ files: { 'package.json': '{ "name": "demo" }' } });
    const { stderr } = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });
    const listed = stderr.indexOf(
      'installing oxlint oxlint-tsgolint oxfmt eslint @venizia/dev-configs\n',
    );

    expect(listed).toBeGreaterThan(-1);
    expect(listed).toBeLessThan(stderr.indexOf('skipped  bun add'));
  });

  test('a failed install exits 1, says what to run, and still lists what is left', () => {
    const root = createProject({ files: { 'package.json': '{ "name": "demo" }' } });
    const result = runCli({
      args: ['init'],
      cwd: root,
      env: { VULCAN_BUN: createFakeCommand({ body: 'echo offline >&2; exit 7' }) },
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "vulcan init: 'bun add -d --exact oxlint oxlint-tsgolint oxfmt eslint @venizia/dev-configs' failed - run it yourself",
    );
    expect(result.stderr).toContain('left to do:');
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(true);
  });

  test('a directory without package.json is refused before anything is written', () => {
    const root = createProject({ files: {} });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no package.json');
    expect(result.stderr).toContain('bun init');
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(root, '.configs'))).toBe(false);
  });

  test('declared lint tools are not installed again', () => {
    const root = createProject({
      files: {
        'package.json':
          '{ "name": "demo", "devDependencies": { "@venizia/dev-configs": "0.3.1", "oxlint": "1", "oxlint-tsgolint": "7", "oxfmt": "0", "eslint": "10" } }',
      },
    });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    expect(result.stderr).not.toContain('bun add');
  });

  test('a workspaces project installs the style package only', () => {
    const root = createProject({
      files: { 'package.json': '{ "name": "demo", "workspaces": ["apps/*"] }' },
    });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    expect(result.stderr).toContain(
      'skipped  bun add -d --exact @venizia/dev-configs (VULCAN_NO_INSTALL)',
    );
  });

  test('ends with a numbered list naming the scaffold marker', () => {
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE } });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    expect(result.stderr).toContain('left to do:');
    expect(result.stderr).toContain(
      '1. describe the project in .agents/knowledge/index.md, then delete the vulcan:scaffold line',
    );
    expect(result.stderr).toContain(
      'bun x --no-install vulcan sync && bun x --no-install vulcan doctor',
    );
  });

  test('init never scaffolds .mcp.json: sync writes it per machine, for the agents that read it', () => {
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE } });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    expect(existsSync(join(root, '.mcp.json'))).toBe(false);
    expect(result.stderr).not.toContain('.mcp.json');
  });

  test('an existing .mcp.json is left alone, with no hint about it', () => {
    const mine = '{ "mcpServers": { "other": { "command": "x" } } }\n';
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE, '.mcp.json': mine } });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    expect(readFileSync(join(root, '.mcp.json'), 'utf8')).toBe(mine);
    expect(result.stderr).not.toContain('.mcp.json');
    expect(result.stderr).not.toContain('the atlas server');
  });

  test('the Makefile explains itself when vulcan.mk is missing: a shipped target says to install first, the project own targets still run', () => {
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE } });

    runCli({ args: ['init'], cwd: root, env: NO_INSTALL });
    writeFileSync(
      join(root, 'Makefile'),
      `${readFileSync(join(root, 'Makefile'), 'utf8')}\ninstall:\n\t@echo installing\n`,
    );

    // Under `make test` the parent's MAKEFLAGS would make the child print "Entering directory".
    const env = { ...process.env, MAKEFLAGS: '', MAKELEVEL: '', MFLAGS: '' };
    const make = (target: string) =>
      Bun.spawnSync(['make', '--no-print-directory', target], {
        cwd: root,
        env,
        stderr: 'pipe',
        stdout: 'pipe',
      });
    const shipped = make('okf-check-strict');
    const own = make('install');

    expect(shipped.exitCode).not.toBe(0);
    expect(shipped.stderr.toString()).toContain("run 'make install' (bun install) first");
    expect(shipped.stderr.toString()).not.toContain('No rule to make target');
    expect(own.exitCode).toBe(0);
    expect(own.stdout.toString()).toBe('installing\n');
    expect(own.stderr.toString()).toBe('');
  });

  test('a workspaces project keeps its lint configs per app: none is written at the root', () => {
    const root = createProject({
      files: { 'package.json': '{ "name": "demo", "workspaces": ["apps/*"] }' },
    });
    const result = runCli({ args: ['init'], cwd: root, env: NO_INSTALL });

    for (const file of [
      'lints/oxlint.config.mts',
      'lints/eslint.config.mjs',
      'formatters/oxfmt.config.mts',
    ]) {
      expect(existsSync(join(root, '.configs', file))).toBe(false);
    }

    expect(existsSync(join(root, '.configs/vulcan.config.mts'))).toBe(true);
    expect(result.stderr).toContain('skipped');
    expect(result.stderr).toContain('per app');
  });

  test('the object form of workspaces counts too', () => {
    const root = createProject({
      files: { 'package.json': '{ "name": "demo", "workspaces": { "packages": ["apps/*"] } }' },
    });

    runCli({ args: ['init'], cwd: root, env: NO_INSTALL });
    expect(existsSync(join(root, '.configs/lints/oxlint.config.mts'))).toBe(false);
  });

  test('init, then sync: doctor names what is left to fill in, and is green once it is', () => {
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE } });

    runCli({ args: ['init'], cwd: root, env: NO_INSTALL });
    runCli({ args: ['sync'], cwd: root });
    const raw = runCli({ args: ['doctor'], cwd: root });

    expect(raw.code).toBe(1);
    expect(raw.stderr).toContain('[scaffold] .agents/knowledge/index.md');

    const index = join(root, '.agents/knowledge/index.md');

    writeFileSync(
      index,
      readFileSync(index, 'utf8')
        .split('\n')
        .filter(line => !line.includes('vulcan:scaffold'))
        .join('\n'),
    );
    const filled = runCli({ args: ['doctor'], cwd: root });

    expect(filled.stderr).toContain('vulcan doctor: OK');
    expect(filled.code).toBe(0);
  });

  test('the scaffolded knowledge bundle is OKF v0.2 conformant', () => {
    const root = createProject({ files: { 'package.json': STYLED_PACKAGE } });

    runCli({ args: ['init'], cwd: root, env: NO_INSTALL });
    const check = runCli({ args: ['x', 'okf', 'check'], cwd: root });

    expect(check.code).toBe(0);
    expect(check.stdout).toContain('OKF v0.2');
  });
});
