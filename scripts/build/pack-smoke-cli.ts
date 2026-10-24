#!/usr/bin/env bun
/**
 * Proves the three packed tarballs work outside the workspace: an empty project installs
 * @venizia/vulcan alone, then runs init, sync, doctor, `x okf` and `x atlas mcp` - the project
 * itself and a source it declares, a local bare repository read through git.
 *
 * It also runs every hook the generated `.claude/settings.json` registers, from the installed tarball:
 * each hook runs one benign call and must exit 0; with `zod` made unresolvable the blocking hooks still
 * work; with a module of the hook path removed a crashed safety hook still lets `bun install` through,
 * and the drift guards pass the call. A release whose hooks cannot load stops every tool call in every
 * project that syncs it, so none goes out before this step passes.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

interface IStepResult {
  ok: boolean;
  stdout: string;
  detail: string;
}

const PACKAGES_DIRECTORY = resolve(import.meta.dir, '..', '..', 'packages');
const STYLE_PACKAGE_VERSION = '0.3.1-0';
const MINIMUM_ATLAS_TOOLS = 6;

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

const probeConfigOf = (opts: { sourceUrl: string }): string => `export default {
  okf: { renderers: [{ id: 'probe', module: '.agents/okf/probe.ts' }] },
  atlas: { sources: [{ name: 'remote', repo: '${opts.sourceUrl}', ref: 'develop' }] },
};
`;

// A registry that refuses at once: the source pull's npm symbol step skips instead of reaching npm.
const NO_REGISTRY = 'http://127.0.0.1:9';

/** What the source commits for atlas - its manifest and one concept the search below must find. */
const SOURCE_FILES: Record<string, string> = {
  '.agents/vulcan.manifest.json': `${JSON.stringify(
    {
      schemaVersion: 1,
      name: 'remote',
      packages: [
        {
          name: '@remote/kernel',
          dir: 'kernel',
          path: 'packages/kernel',
          aliases: [],
          retired: false,
        },
      ],
      knowledge: { bundle: '.agents/knowledge', changelogs: 'docs/changelogs' },
      release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
    },
    null,
    2,
  )}\n`,
  '.agents/knowledge/overview/lighthouse.md':
    '---\ntype: Concept\ntitle: Lighthouse\ndescription: The remote lighthouse.\n---\n\nThe lighthouse keeper starts the remote kernel.\n',
};

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
  env?: Record<string, string>;
}): IStepResult => {
  const [executable, ...args] = opts.command;
  const result = spawnSync(executable, args, {
    cwd: opts.cwd,
    input: opts.input,
    encoding: 'utf8',
    env: { ...process.env, ...opts.env },
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
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'search', arguments: { query: 'lighthouse keeper' } },
    },
  ]
    .map(request => JSON.stringify(request))
    .join('\n')
    .concat('\n');

/**
 * Every stdout line is a JSON-RPC frame, tools/list answers with the atlas tools, and the search
 * finds the concept only the declared source holds.
 */
const inspectMcpOutput = (opts: { stdout: string }): string | undefined => {
  const lines = opts.stdout.trim().split('\n').filter(Boolean);
  const frames = lines.map(line => {
    try {
      const frame: {
        jsonrpc?: string;
        id?: number;
        result?: { tools?: unknown[]; content?: { text: string }[] };
      } = JSON.parse(line);

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

  const toolCount = frames.find(frame => frame?.id === 2)?.result?.tools?.length ?? 0;

  if (toolCount < MINIMUM_ATLAS_TOOLS) {
    return `x atlas: tools/list returned ${toolCount} tools`;
  }

  const searched = frames.find(frame => frame?.id === 3)?.result?.content?.[0]?.text ?? '';

  return searched.includes('"source":"remote"')
    ? undefined
    : `x atlas: the search found nothing in the declared source: ${searched.slice(0, 200)}`;
};

const git = (opts: { cwd: string; args: string[] }): string | undefined => {
  const result = runStep({
    name: `git ${opts.args[0]}`,
    command: ['git', '-c', 'user.name=smoke', '-c', 'user.email=smoke@smoke', ...opts.args],
    cwd: opts.cwd,
    expectedCode: 0,
  });

  return result.ok ? undefined : result.detail;
};

/** The declared source: a bare repository holding `SOURCE_FILES`; its `file://` URL, or a failure. */
const makeSource = (opts: { sandbox: string }): { url?: string; failure?: string } => {
  const bare = join(opts.sandbox, 'source.git');
  const work = join(opts.sandbox, 'source-work');

  mkdirSync(bare);
  mkdirSync(work);

  for (const [path, content] of Object.entries(SOURCE_FILES)) {
    mkdirSync(dirname(join(work, path)), { recursive: true });
    writeFileSync(join(work, path), content);
  }

  const failure =
    git({ cwd: bare, args: ['init', '-q', '--bare', '-b', 'develop'] }) ??
    git({ cwd: work, args: ['init', '-q', '-b', 'develop'] }) ??
    git({ cwd: work, args: ['add', '-A'] }) ??
    git({ cwd: work, args: ['commit', '-q', '-m', 'source'] }) ??
    git({ cwd: work, args: ['push', '-q', bare, 'develop'] });

  return failure === undefined ? { url: `file://${bare}` } : { failure };
};


interface IHookEntry {
  event: string;
  matcher: string;
  command: string;
}

/** Every hook command the sandbox's generated settings register, as Claude Code would run it. */
const hooksOf = (opts: { sandbox: string }): IHookEntry[] => {
  type TSettings = {
    hooks?: Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
  };
  const settings: TSettings = JSON.parse(
    readFileSync(join(opts.sandbox, '.claude', 'settings.json'), 'utf8'),
  );
  const sources = [settings];

  return sources.flatMap((settings) =>
    Object.entries(settings.hooks ?? {}).flatMap(([event, entries]) =>
      entries.flatMap((entry) =>
        entry.hooks.map((hook) => ({ event, matcher: entry.matcher ?? '', command: hook.command })),
      ),
    ),
  );
};

const hookNameOf = (opts: { hook: IHookEntry }): string =>
  /hooks\/([\w-]+)\.ts/.exec(opts.hook.command)?.[1] ?? opts.hook.command.slice(0, 40);

/** Every benign call the hook's matcher covers: a Bash `ls`, a Write inside the project, or the event itself. */
const benignPayloadsOf = (opts: { hook: IHookEntry; sandbox: string; command?: string }): string[] => {
  if (opts.hook.event === 'SessionStart') {
    return ['{"hook_event_name":"SessionStart","source":"startup"}'];
  }

  if (opts.hook.event === 'Stop') {
    return ['{"hook_event_name":"Stop","last_assistant_message":"Everything is in order and nothing needs your attention right now, because the work is done and every check ran as expected today.","stop_hook_active":false}'];
  }

  if (opts.hook.event === 'UserPromptSubmit') {
    return ['{"hook_event_name":"UserPromptSubmit","prompt":"hello"}'];
  }

  if (opts.hook.event === 'SubagentStart') {
    return ['{"hook_event_name":"SubagentStart","agent_type":"general-purpose","agent_id":"smoke"}'];
  }

  const cwd = JSON.stringify(opts.sandbox);
  const payloads: string[] = [];

  if (opts.hook.matcher.includes('Bash')) {
    payloads.push(
      `{"tool_name":"Bash","tool_input":{"command":${JSON.stringify(opts.command ?? 'ls')}},"cwd":${cwd}}`,
    );
  }

  if (/Write|Edit/.test(opts.hook.matcher) && opts.command === undefined) {
    payloads.push(
      `{"tool_name":"Write","tool_input":{"file_path":${JSON.stringify(join(opts.sandbox, 'a.txt'))}},"cwd":${cwd}}`,
    );
  }

  return payloads;
};

/** Runs the hook on every benign payload; the first one that does not exit as expected, or `undefined`. */
const firstUnexpected = (opts: {
  hook: IHookEntry;
  sandbox: string;
  expected: number;
  command?: string;
}): { code: number; stderr: string } | undefined =>
  benignPayloadsOf(opts)
    .map((payload) => runHook({ hook: opts.hook, sandbox: opts.sandbox, payload }))
    .find((result) => result.code !== opts.expected);

const runHook = (opts: { hook: IHookEntry; sandbox: string; payload: string }) => {
  const result = spawnSync('/bin/sh', ['-c', opts.hook.command], {
    cwd: opts.sandbox,
    input: opts.payload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: opts.sandbox },
    timeout: 60_000,
  });

  return { code: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

const BLOCKING = new Set([
  'guard-writes',
  'guard-manifest',
  'guard-package',
  'guard-remote-hosts',
  'guard-git',
  'guard-outside',
]);
const SAFETY = new Set(['guard-writes', 'guard-manifest', 'guard-package', 'guard-remote-hosts']);

/** A path of the installed package moved aside while `run` executes, then put back. */
const withoutFile = <T>(opts: { path: string; run: () => T }): T => {
  const aside = `${opts.path}.smoke-aside`;

  renameSync(opts.path, aside);

  try {
    return opts.run();
  } finally {
    renameSync(aside, opts.path);
  }
};

/**
 * A package moved aside and replaced by a stub that throws when it loads, while `run` executes, then put
 * back. A stub, not an absence: the sandbox may sit inside a repository whose own node_modules would
 * otherwise still resolve the package.
 */
const withBrokenPackages = <T>(opts: { paths: string[]; run: () => T }): T => {
  const [first, ...rest] = opts.paths;

  if (first === undefined) {
    return opts.run();
  }

  return withoutFile({
    path: first,
    run: () => {
      mkdirSync(first, { recursive: true });
      writeFileSync(join(first, 'package.json'), '{"name":"stub","main":"index.js"}');
      writeFileSync(join(first, 'index.js'), 'throw new Error("unavailable: broken by the pack smoke");\n');

      try {
        return withBrokenPackages({ paths: rest, run: opts.run });
      } finally {
        rmSync(first, { recursive: true, force: true });
      }
    },
  });
};

/** The hooks, from the tarball: a failure message, or `undefined` when every case held. */
const smokeHooks = (opts: { sandbox: string }): string | undefined => {
  const { sandbox } = opts;
  const hooks = hooksOf({ sandbox });
  const blocking = hooks.filter((hook) => BLOCKING.has(hookNameOf({ hook })));

  for (const required of [...BLOCKING, 'session-start', 'subagent-start', 'stop', 'prompt-submit']) {
    if (!hooks.some((hook) => hookNameOf({ hook }) === required)) {
      return `hooks: nothing registers ${required}`;
    }
  }

  for (const hook of hooks) {
    const bad = firstUnexpected({ hook, sandbox, expected: 0 });

    if (bad !== undefined) {
      return `hooks: ${hookNameOf({ hook })} exited ${bad.code} on a benign call: ${bad.stderr.slice(-300)}`;
    }
  }

  const start = hooks.find((hook) => hook.event === 'SessionStart');
  const [startPayload] = start === undefined ? [] : benignPayloadsOf({ hook: start, sandbox });
  const digest =
    start === undefined || startPayload === undefined
      ? undefined
      : runHook({ hook: start, sandbox, payload: startPayload });

  if (!digest?.stdout.includes('VULCAN rules')) {
    return 'hooks: session-start printed no rules digest';
  }

  const prompt = hooks.find((hook) => hook.event === 'UserPromptSubmit');
  const [promptPayload] = prompt === undefined ? [] : benignPayloadsOf({ hook: prompt, sandbox });
  const contract =
    prompt === undefined || promptPayload === undefined
      ? undefined
      : runHook({ hook: prompt, sandbox, payload: promptPayload });

  if (!contract?.stdout.includes('Owner reply contract')) {
    return 'hooks: prompt-submit printed no owner reply contract';
  }

  const installed = join(sandbox, 'node_modules', '@venizia', 'vulcan');
  // Every copy of zod the hooks could resolve: one left behind would make the case below pass for nothing.
  const zods = [join(sandbox, 'node_modules', 'zod'), join(installed, 'node_modules', 'zod')].filter(
    (path) => existsSync(path),
  );

  if (zods.length === 0) {
    return 'hooks: cannot find the installed zod to break - the check would pass for nothing';
  }

  // The blocking hooks must not need zod, config or rules: a drift in those must not stop every call.
  const withoutZod = withBrokenPackages({
    paths: zods,
    run: () =>
      blocking
        .map((hook) => ({ hook, bad: firstUnexpected({ hook, sandbox, expected: 0 }) }))
        .find((item) => item.bad !== undefined),
  });

  if (withoutZod?.bad !== undefined) {
    return `hooks: ${hookNameOf({ hook: withoutZod.hook })} exited ${withoutZod.bad.code} with zod unresolvable: ${withoutZod.bad.stderr.slice(-300)}`;
  }

  // A module of the hook path gone: a safety hook crashes and blocks - except a bare `bun install`,
  // the escape - and the drift guards pass the call.
  return withoutFile({
    path: join(installed, 'src', 'hooks', 'common', 'constants.ts'),
    run: () => {
      for (const hook of blocking) {
        const name = hookNameOf({ hook });
        const expected = SAFETY.has(name) ? 2 : 0;
        const bad = firstUnexpected({ hook, sandbox, expected });

        if (bad !== undefined) {
          return `hooks: with a module of the hook path removed ${name} exited ${bad.code} on a benign call, expected ${expected}`;
        }

        const install = firstUnexpected({ hook, sandbox, expected: 0, command: 'bun install' });

        if (hook.matcher.includes('Bash') && install !== undefined) {
          return `hooks: with a module of the hook path removed ${name} blocked a bare bun install (exit ${install.code}) - the agent could not repair the install`;
        }
      }

      return undefined;
    },
  });
};

const tarballs: string[] = [];
const sandbox = mkdtempSync(join(tmpdir(), 'vulcan-cli-smoke-'));
// The source lives beside the project, never inside it: the project's okf and git see none of it.
const sourceSandbox = mkdtempSync(join(tmpdir(), 'vulcan-cli-smoke-source-'));
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
      // The raw scaffold is not done: doctor names the index marker until the project fills it in.
      {
        name: 'doctor on the raw scaffold',
        command: ['bun', 'x', 'vulcan', 'doctor'],
        expectedCode: 1,
      },
      {
        name: 'fill in the index',
        command: [
          'bun',
          '-e',
          "const file = '.agents/knowledge/index.md'; await Bun.write(file, (await Bun.file(file).text()).split('\\n').filter(line => !line.includes('vulcan:scaffold')).join('\\n'));",
        ],
        expectedCode: 0,
      },
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

    // The project sets `remoteHosts`, so `sync` registers the remote-host guard too and the manifest
    // carries the policy it reads: every hook of the product runs below, not only the default ones.
    if (failure === undefined) {
      const configFile = join(sandbox, '.configs/vulcan.config.mts');
      const config = readFileSync(configFile, 'utf8');

      writeFileSync(
        configFile,
        config.replace(
          'export default {',
          "export default {\n  remoteHosts: { trusted: ['example.test'], readOnly: [] },",
        ),
      );

      const synced = runStep({
        name: 'sync with remoteHosts',
        command: ['bun', 'x', 'vulcan', 'sync'],
        cwd: sandbox,
        expectedCode: 0,
      });

      failure = synced.ok ? undefined : synced.detail;
    }

    // Every registered hook, from the installed tarball (the release-blocking check on the hook path).
    failure ??= smokeHooks({ sandbox });

    // A project module, written the way the adoption guide says: resolves, type-checks, renders.
    const source = failure === undefined ? makeSource({ sandbox: sourceSandbox }) : {};

    failure ??= source.failure;

    if (failure === undefined) {
      mkdirSync(join(sandbox, '.agents/okf'), { recursive: true });
      writeFileSync(join(sandbox, '.agents/okf/probe.ts'), PROBE_MODULE);
      writeFileSync(join(sandbox, 'tsconfig.json'), PROBE_TSCONFIG);
      writeFileSync(
        join(sandbox, '.configs/vulcan.config.mts'),
        probeConfigOf({ sourceUrl: source.url ?? '' }),
      );

      for (const step of [
        // The source rides in the manifest, which atlas reads - never the config.
        { name: 'sync with a source', command: ['bun', 'x', 'vulcan', 'sync'], expectedCode: 0 },
        {
          name: 'okf module type-checks',
          command: ['bun', 'check', '--no-pretty', '-p', '.'],
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
        env: { VULCAN_NPM_REGISTRY: NO_REGISTRY },
      });

      failure = mcp.ok ? inspectMcpOutput({ stdout: mcp.stdout }) : mcp.detail;
    }
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true });
  rmSync(sourceSandbox, { recursive: true, force: true });

  for (const tarball of tarballs) {
    rmSync(tarball, { force: true });
  }
}

if (failure !== undefined) {
  console.error(`pack-smoke: FAIL - ${failure}`);
  process.exit(1);
}

console.log(
  'pack-smoke: OK - install, init, sync, doctor, every registered hook from the tarball (benign calls, zod unresolvable, a crashed safety hook), x okf check, an okf module from @venizia/vulcan/okf (bun check, gen), x atlas mcp over the project and a bare-repository source (JSON-RPC only on stdout)',
);
