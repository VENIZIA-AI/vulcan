import { afterAll, afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TypeScriptCompiler } from '@/common/compiler';
import { clearAtlasProject, useAtlasProject } from '../project.helper';

const root = mkdtempSync(join(tmpdir(), 'atlas-compiler-'));

afterEach(clearAtlasProject);
afterAll(() => rmSync(root, { recursive: true, force: true }));

test('a project typescript without the compiler API (TypeScript 7) falls back to atlas own', () => {
  const stub = join(root, 'node_modules', 'typescript');

  mkdirSync(stub, { recursive: true });
  writeFileSync(join(root, 'package.json'), '{ "name": "ts7-project" }\n');
  writeFileSync(
    join(stub, 'package.json'),
    '{ "name": "typescript", "version": "7.0.2", "main": "index.js" }\n',
  );
  // TypeScript 7.0's main export: a version and nothing else.
  writeFileSync(
    join(stub, 'index.js'),
    "module.exports = { version: '7.0.2', versionMajorMinor: '7.0' };\n",
  );

  const declarations = join(root, 'index.d.ts');

  writeFileSync(declarations, 'export declare function greet(name: string): string;\n');

  useAtlasProject({ root, manifest: {} });

  const compiler = TypeScriptCompiler.load({ from: root });
  const program = compiler.createProgram([declarations], { skipLibCheck: true });
  const source = program.getSourceFile(declarations);
  const checker = program.getTypeChecker();
  const moduleSymbol = source === undefined ? undefined : checker.getSymbolAtLocation(source);
  const names =
    moduleSymbol === undefined
      ? []
      : checker.getExportsOfModule(moduleSymbol).map((symbol) => symbol.getName());

  expect(names).toEqual(['greet']);
});

test('a directory without node_modules never makes Bun auto-install typescript', async () => {
  const requests: string[] = [];
  const registry = Bun.serve({
    port: 0,
    fetch: (request) => {
      requests.push(new URL(request.url).pathname);

      return new Response('{}', { status: 404 });
    },
  });
  const bare = mkdtempSync(join(tmpdir(), 'atlas-bare-'));
  const script = join(bare, 'load.ts');

  try {
    writeFileSync(
      script,
      `import { TypeScriptCompiler } from ${JSON.stringify(join(__dirname, '..', '..', 'common', 'compiler.ts'))};\n` +
        `const compiler = TypeScriptCompiler.load({ from: ${JSON.stringify(bare)} });\n` +
        `console.log(typeof compiler.createProgram);\n`,
    );

    const child = Bun.spawn({
      cmd: [process.execPath, '--install=auto', script],
      cwd: bare,
      env: { ...process.env, BUN_CONFIG_REGISTRY: `http://127.0.0.1:${registry.port}/` },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    await child.exited;

    expect(await new Response(child.stdout).text()).toBe('function\n');
    expect(requests).toEqual([]);
  } finally {
    await registry.stop(true);
    rmSync(bare, { recursive: true, force: true });
  }
});

test('without any typescript to read, load fails with a message that says what to install', () => {
  const bare = mkdtempSync(join(tmpdir(), 'atlas-no-typescript-'));

  try {
    expect(() => TypeScriptCompiler.load({ from: bare, own: bare })).toThrow(
      'atlas: cannot find typescript',
    );
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
});
