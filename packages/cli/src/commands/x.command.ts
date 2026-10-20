import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ExitCodes, PACKAGE_ROOT, ProjectLayout, VulcanTools } from '../common/index.ts';
import { findConfigFiles, loadConfig, resolvePackages } from '../config/index.ts';
import { ManifestConstants, renderManifest } from '../manifest/index.ts';
import type { ICommandContext, IToolPackage } from '../common/index.ts';

const TOOL_PACKAGES: Record<string, IToolPackage> = {
  [VulcanTools.OKF]: { packageName: '@venizia/vulcan-okf', binName: 'vulcan-okf' },
  [VulcanTools.ATLAS]: { packageName: '@venizia/vulcan-atlas', binName: 'vulcan-atlas' },
};

interface IPackageManifest {
  bin?: string | Record<string, string>;
}

const listTools = (): string => [...VulcanTools.SCHEME_SET].join(', ');

/** The tool's bin inside its installed package, resolved from @venizia/vulcan; `undefined` when not installed. */
export const resolveToolBin = (opts: { name: string }): string | undefined => {
  const tool = TOOL_PACKAGES[opts.name];

  if (tool === undefined) {
    return undefined;
  }

  let manifestPath: string;

  try {
    manifestPath = Bun.resolveSync(`${tool.packageName}/package.json`, PACKAGE_ROOT);
  } catch (error) {
    process.stderr.write(
      `vulcan x: ${tool.packageName} is not resolvable - ${error instanceof Error ? error.message : String(error)}\n`,
    );

    return undefined;
  }

  const manifest: IPackageManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[tool.binName];

  return bin === undefined ? undefined : join(dirname(manifestPath), bin);
};

/**
 * The environment a tool runs with: the project's resolved config, validated once here, when the
 * project has one. No config is fine (atlas serves sources without one); an invalid one is an error.
 */
export const buildToolEnvironment = async (opts: {
  root: string;
}): Promise<{ ok: true; env: Record<string, string> } | { ok: false; error: string }> => {
  if (findConfigFiles({ root: opts.root }).length === 0) {
    return { ok: true, env: {} };
  }

  const loaded = await loadConfig({ root: opts.root });

  if (!loaded.ok) {
    return { ok: false, error: loaded.error };
  }

  const config = { ...loaded.config, packages: resolvePackages({ config: loaded.config }) };

  return {
    ok: true,
    env: {
      [ProjectLayout.CONFIG_ENV]: JSON.stringify(config),
      [ProjectLayout.ROOT_ENV]: opts.root,
      // Atlas reads the manifest only; rendered fresh, so a run never sees a stale committed one.
      [ManifestConstants.ENV]: renderManifest({ root: opts.root, config: loaded.config }),
    },
  };
};

/** Runs the tool as a child on the inherited stdio: vulcan writes nothing to stdout, so MCP stays clean. */
export const runXCommand = async (opts: ICommandContext): Promise<number> => {
  const [name, ...toolArgs] = opts.args;

  if (name === undefined || !VulcanTools.isValid(name)) {
    const subject = name === undefined ? 'no tool given' : `unknown tool '${name}'`;

    process.stderr.write(`vulcan x: ${subject} - known tools: ${listTools()}\n`);

    return ExitCodes.FAILURE;
  }

  const bin = resolveToolBin({ name });

  if (bin === undefined) {
    process.stderr.write(
      `vulcan x: ${TOOL_PACKAGES[name].packageName} has no '${TOOL_PACKAGES[name].binName}' bin - run 'bun install'\n`,
    );

    return ExitCodes.FAILURE;
  }

  const environment = await buildToolEnvironment({ root: opts.cwd });

  if (!environment.ok) {
    process.stderr.write(`vulcan x: ${environment.error}\n`);

    return ExitCodes.FAILURE;
  }

  const child = Bun.spawn([process.execPath, bin, ...toolArgs], {
    cwd: opts.cwd,
    env: { ...process.env, ...environment.env },
    stdio: ['inherit', 'inherit', 'inherit'],
  });

  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));

  return child.exited;
};
