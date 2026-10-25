import { readAtlasProject } from '@/common/project-config';
import { SourceModes } from '@/sources/common';
import type { Transport } from '@/protocol';
import { buildSourcesServer } from './server/index';

/**
 * The MCP transport for one project, in repo mode: its manifest's knowledge, live. A project that
 * also reads other sources goes through `buildSourcesServer`, which this is the one-source case of.
 */
export const buildServer = (opts: { root: string; version: string }): Transport => {
  const project = readAtlasProject({ root: opts.root });

  return buildSourcesServer({
    sources: [{ name: project.name, root: opts.root, mode: SourceModes.REPOSITORY, project }],
    cwd: opts.root,
    version: opts.version,
  });
};
