import { ProjectConfig } from '@/common/project-config';
import { SourcesServer } from '@/server/index';
import { SourceModes } from '@/sources/common';

/**
 * The MCP transport for one project read from its own manifest, live: the one-source case of
 * `SourcesServer.build`, which is what the CLI calls for every source set.
 */
export const buildRepositoryServer = (opts: {
  root: string;
  version: string;
}): ReturnType<typeof SourcesServer.build> => {
  const project = ProjectConfig.readAtlasProject({ root: opts.root });

  return SourcesServer.build({
    sources: [{ name: project.name, root: opts.root, mode: SourceModes.REPOSITORY, project }],
    cwd: opts.root,
    version: opts.version,
  });
};
