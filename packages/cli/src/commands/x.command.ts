import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ExitCodes, PACKAGE_ROOT, VulcanTools } from '../common/index.ts';
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

  const child = Bun.spawn([process.execPath, bin, ...toolArgs], {
    cwd: opts.cwd,
    stdio: ['inherit', 'inherit', 'inherit'],
  });

  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));

  return child.exited;
};
