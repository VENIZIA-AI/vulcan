import { ProjectConfig } from '@/common/project-config';
import { SourceModes } from '@/sources/common';
import type { Transport } from '@/protocol';
import { SourcesServer } from './server/index';

export class ServerFactory {
  /**
   * The MCP transport for one project, in repo mode: its manifest's knowledge, live. A project that
   * also reads other sources goes through `SourcesServer.build`, which this is the one-source case of.
   */
  static build(opts: { root: string; version: string }): Transport {
    const project = ProjectConfig.readAtlasProject({ root: opts.root });

    return SourcesServer.build({
      sources: [{ name: project.name, root: opts.root, mode: SourceModes.REPOSITORY, project }],
      cwd: opts.root,
      version: opts.version,
    });
  }
}
