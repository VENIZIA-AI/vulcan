import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { driveTerminal, KEYS } from '../terminal.helper.ts';

afterAll(removeProjects);

const hasScript = Bun.which('script') !== null;
const ENV = { VULCAN_NO_INSTALL: '1', TERM: 'dumb' };
const BACKEND = join(import.meta.dir, '..', 'fixtures', 'preset-backend');
const CONFIG = '.configs/vulcan.config.mts';

const app = (name: string, extra: Record<string, string> = {}): string =>
  createProject({ files: { 'package.json': JSON.stringify({ name }), ...extra } });
const init = (opts: { root: string; args?: string[] }) =>
  runCli({ args: ['init', ...(opts.args ?? [])], cwd: opts.root, env: ENV });

describe('vulcan init: the project key', () => {
  test('with no terminal the key is made from the name, said, and written to the config', () => {
    const root = app('acme-shop');
    const result = init({ root });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toContain('project key ACMESHOP, made from the name');
    expect(readFileSync(join(root, CONFIG), 'utf8')).toContain("project: { key: 'ACMESHOP' }");
  });

  test('--key wins over the name', () => {
    const root = app('acme-shop');
    const result = init({ root, args: ['--key', 'ACME'] });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).not.toContain('made from the name');
    expect(readFileSync(join(root, CONFIG), 'utf8')).toContain("project: { key: 'ACME' }");
  });

  test.each(['acme', 'B', 'TOOLONGKEY', 'BA-NA'])(
    '--key %p is refused, and nothing is written',
    (key) => {
      const root = app('acme-shop');
      const result = init({ root, args: ['--key', key] });

      expect(result.code).toBe(2);
      expect(result.stderr).toContain('is not a key');
      expect(existsSync(join(root, CONFIG))).toBe(false);
    },
  );

  test('a name that makes no key is an error that asks for --key', () => {
    const root = app('x');
    const result = init({ root });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('pass --key');
    expect(existsSync(join(root, CONFIG))).toBe(false);
  });

  test('an existing config is kept and nothing is asked: its key, or none, stays', () => {
    const own = "export default { name: 'x', rules: { 'V-W-01': 'on-user-word' } };\n";
    const root = app('x', { [CONFIG]: own });
    const result = init({ root });

    expect(result.code, result.stderr).toBe(0);
    expect(readFileSync(join(root, CONFIG), 'utf8')).toBe(own);
  });

  test('init --preset writes the key into the new monorepo config too', () => {
    const parent = createProject({ files: {} });
    const result = runCli({
      args: [
        'init',
        '--preset',
        `file:${BACKEND}`,
        '--project',
        'my-product',
        '--backend-dir',
        'services',
        '--app',
        'core-api',
      ],
      cwd: parent,
      env: ENV,
    });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toContain('project key MYPRODUC');
    expect(readFileSync(join(parent, 'my-product', CONFIG), 'utf8')).toContain(
      "project: { key: 'MYPRODUC' }",
    );
  });
});

describe.skipIf(!hasScript)('vulcan init in a terminal asks for the key', () => {
  const asked = async (opts: { send: string[] }) => {
    const root = app('acme-shop');
    const result = await driveTerminal({
      args: ['init'],
      cwd: root,
      env: { ...ENV, TERM: 'xterm-256color', LANG: 'en_US.UTF-8' },
      steps: [
        ...opts.send.map((text) => ({
          waitFor: 'Project key for flow ids',
          send: `${text}${KEYS.ENTER}`,
        })),
        { waitFor: 'Tell VULCAN how you like to work', send: `n${KEYS.ENTER}` },
      ],
    });

    return { root, result };
  };

  test('an empty answer takes the key made from the name', async () => {
    const { root, result } = await asked({ send: [''] });

    expect(result.code).toBe(0);
    expect(readFileSync(join(root, CONFIG), 'utf8')).toContain("project: { key: 'ACMESHOP' }");
  });

  test('a typed key is taken, in capitals; one that is not a key is asked again', async () => {
    const { root, result } = await asked({ send: ['x!', 'acme'] });

    expect(result.code).toBe(0);
    expect(readFileSync(join(root, CONFIG), 'utf8')).toContain("project: { key: 'ACME' }");
  });
});
