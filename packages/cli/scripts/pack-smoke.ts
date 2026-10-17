#!/usr/bin/env bun
/**
 * Proves the three packed tarballs work outside the workspace: an empty project installs
 * @venizia/vulcan alone, then runs init, sync, doctor, `x okf` and `x atlas mcp`.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

interface IStepResult {
  ok: boolean;
  stdout: string;
  detail: string;
}

const PACKAGES_DIRECTORY = resolve(import.meta.dir, '..', '..');
const STYLE_PACKAGE_VERSION = '0.3.1-0';
const MINIMUM_ATLAS_TOOLS = 5;

/** The workspace catalog: the sandbox type-checks with the same typescript and Bun types. */
const CATALOG: Record<string, string> = JSON.parse(
  readFileSync(resolve(PACKAGES_DIRECTORY, '..', 'package.json'), 'utf8'),
).workspaces.catalog;

/**
 * A project module as a project writes one: it imports the renderer API from `@venizia/vulcan/okf`,
 * the only VULCAN package a project installs. Type-checked, then run by `vulcan x okf gen`.
 */
const PROBE_MODULE = `import { defineRenderer } from '@venizia/vulcan/okf';

export default defineRenderer({
  id: 'probe',
  collect: ({ context }) => context.source.listDirs({ dir: '.agents' }),
  render: ({ context, facts }) => ({
    path: 'reference/probe.md',
    content:
      context.page.header({ title: 'Probe', description: 'Smoke.', resource: '.agents', tags: ['reference'] }) +
      \`\${facts.length} directories.\\n\`,
  }),
});
`;

const PROBE_CONFIG = `export default {
  okf: { renderers: [{ id: 'probe', module: '.agents/okf/probe.ts' }] },
};
`;

const PROBE_TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    target: 'esnext',
    module: 'esnext',
    moduleResolution: 'bundler',
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
    types: ['bun'],
  },
  include: ['.agents/okf'],
});

const runStep = (opts: {
  name: string;
  command: string[];
  cwd: string;
  expectedCode: number;
  input?: string;
}): IStepResult => {
  const [executable, ...args] = opts.command;
  const result = spawnSync(executable, args, {
    cwd: opts.cwd,
    input: opts.input,
    encoding: 'utf8',
  });
  const ok = result.status === opts.expectedCode;

  return {
    ok,
    stdout: result.stdout,
    detail: ok
      ? ''
      : `${opts.name}: exit ${result.status}, expected ${opts.expectedCode}\n${result.stderr}`,
  };
};

/** The tarball `bun pm pack` leaves in the package directory, or `undefined` when packing failed. */
const packPackage = (opts: { directory: string }): string | undefined => {
  const cwd = join(PACKAGES_DIRECTORY, opts.directory);
  const packed = runStep({
    name: `pack ${opts.directory}`,
    command: ['bun', 'pm', 'pack', '--quiet'],
    cwd,
    expectedCode: 0,
  });

  if (!packed.ok) {
    console.error(packed.detail);

    return undefined;
  }

  const tarball = readdirSync(cwd).find(file => file.endsWith('.tgz'));

  return tarball === undefined ? undefined : join(cwd, tarball);
};

interface IManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
}

/**
 * Sibling pins inside the packed cli that differ from the siblings' own versions. `bun pm pack`
 * resolves `workspace:*` from bun.lock, so a stale lock ships a version that is not on npm - and a
 * local tarball install below would mask it.
 */
const findStaleSiblingPins = (opts: { tarball: string }): string[] => {
  const packed = spawnSync('tar', ['-xzOf', opts.tarball, 'package/package.json'], {
    encoding: 'utf8',
  });
  const manifest: IManifest = JSON.parse(packed.stdout);

  return ['okf', 'atlas'].flatMap(directory => {
    const sibling: IManifest = JSON.parse(
      readFileSync(join(PACKAGES_DIRECTORY, directory, 'package.json'), 'utf8'),
    );
    const pinned = manifest.dependencies?.[sibling.name];

    return pinned === sibling.version
      ? []
      : [`${sibling.name} pinned ${pinned}, is ${sibling.version}`];
  });
};

const buildMcpRequests = (): string =>
  [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'smoke', version: '0' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]
    .map(request => JSON.stringify(request))
    .join('\n')
    .concat('\n');

/** Every stdout line is a JSON-RPC frame, and tools/list answers with the atlas tools. */
const inspectMcpOutput = (opts: { stdout: string }): string | undefined => {
  const lines = opts.stdout.trim().split('\n').filter(Boolean);
  const frames = lines.map(line => {
    try {
      const frame: { jsonrpc?: string; result?: { tools?: unknown[] } } = JSON.parse(line);

      return frame;
    } catch (error) {
      console.error(
        `[inspectMcpOutput] not JSON: ${line.slice(0, 80)} | ${error instanceof Error ? error.message : String(error)}`,
      );

      return undefined;
    }
  });

  if (frames.some(frame => frame?.jsonrpc !== '2.0')) {
    return 'x atlas: a stdout line is not a JSON-RPC frame';
  }

  const toolCount = frames.at(-1)?.result?.tools?.length ?? 0;

  return toolCount >= MINIMUM_ATLAS_TOOLS
    ? undefined
    : `x atlas: tools/list returned ${toolCount} tools`;
};

const tarballs: string[] = [];
const sandbox = mkdtempSync(join(tmpdir(), 'vulcan-cli-smoke-'));
let failure: string | undefined;

try {
  for (const directory of ['okf', 'atlas', 'cli']) {
    const tarball = packPackage({ directory });

    if (tarball === undefined) {
      failure = `pack ${directory}: no tarball`;
      break;
    }

    tarballs.push(tarball);
  }

  const stalePins = failure === undefined ? findStaleSiblingPins({ tarball: tarballs[2] }) : [];

  if (stalePins.length > 0) {
    failure = `stale sibling pins in the packed cli (run bun install): ${stalePins.join('; ')}`;
  }

  if (failure === undefined) {
    const [okf, atlas, cli] = tarballs;

    writeFileSync(
      join(sandbox, 'package.json'),
      JSON.stringify({
        name: 'smoke',
        private: true,
        devDependencies: {
          '@venizia/vulcan': `file:${cli}`,
          '@venizia/dev-configs': STYLE_PACKAGE_VERSION,
          typescript: CATALOG.typescript,
          '@types/bun': CATALOG['@types/bun'],
        },
        overrides: {
          '@venizia/vulcan-okf': `file:${okf}`,
          '@venizia/vulcan-atlas': `file:${atlas}`,
        },
      }),
    );

    const steps = [
      { name: 'install', command: ['bun', 'install'], expectedCode: 0 },
      { name: 'init', command: ['bun', 'x', 'vulcan', 'init'], expectedCode: 0 },
      { name: 'sync', command: ['bun', 'x', 'vulcan', 'sync'], expectedCode: 0 },
      { name: 'doctor', command: ['bun', 'x', 'vulcan', 'doctor'], expectedCode: 0 },
      {
        name: 'x okf check',
        command: ['bun', 'x', 'vulcan', 'x', 'okf', 'check'],
        expectedCode: 0,
      },
    ];

    for (const step of steps) {
      const result = runStep({ ...step, cwd: sandbox });

      if (!result.ok) {
        failure = result.detail;
        break;
      }
    }

    // A project module, written the way the adoption guide says: resolves, type-checks, renders.
    if (failure === undefined) {
      mkdirSync(join(sandbox, '.agents/okf'), { recursive: true });
      writeFileSync(join(sandbox, '.agents/okf/probe.ts'), PROBE_MODULE);
      writeFileSync(join(sandbox, 'tsconfig.json'), PROBE_TSCONFIG);
      writeFileSync(join(sandbox, '.configs/vulcan.config.ts'), PROBE_CONFIG);

      for (const step of [
        {
          name: 'okf module type-checks',
          command: ['bun', 'x', 'tsc', '-p', '.'],
          expectedCode: 0,
        },
        { name: 'x okf gen', command: ['bun', 'x', 'vulcan', 'x', 'okf', 'gen'], expectedCode: 0 },
      ]) {
        const result = runStep({ ...step, cwd: sandbox });

        if (!result.ok) {
          failure = `${result.detail}${result.stdout}`;
          break;
        }
      }

      if (
        failure === undefined &&
        !readFileSync(join(sandbox, '.agents/knowledge/reference/probe.md'), 'utf8').includes(
          'directories.',
        )
      ) {
        failure = 'x okf gen: the probe module wrote no reference/probe.md';
      }
    }

    if (failure === undefined) {
      const mcp = runStep({
        name: 'x atlas mcp',
        command: ['bun', 'x', 'vulcan', 'x', 'atlas', 'mcp'],
        cwd: sandbox,
        expectedCode: 0,
        input: buildMcpRequests(),
      });

      failure = mcp.ok ? inspectMcpOutput({ stdout: mcp.stdout }) : mcp.detail;
    }
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true });

  for (const tarball of tarballs) {
    rmSync(tarball, { force: true });
  }
}

if (failure !== undefined) {
  console.error(`pack-smoke: FAIL - ${failure}`);
  process.exit(1);
}

console.log(
  'pack-smoke: OK - install, init, sync, doctor, x okf check, an okf module from @venizia/vulcan/okf (tsc, gen), x atlas mcp (JSON-RPC only on stdout)',
);
