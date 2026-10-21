import { excludePathsOf, readAgentTable } from '../agents/index.ts';
import { shippedSkillNames } from '../sync/exclude.ts';

/** What no image needs: dependencies, build output, git history and the agents' own folders. */
const BASE_PATTERNS = [
  '**/node_modules',
  '**/dist',
  '**/*.tsbuildinfo',
  '**/coverage',
  '**/*.log',
  '.git',
  '.claude',
  '.agents/plans',
];

/**
 * The root `.dockerignore` of a new project: a Dockerfile is built from the project root, so the
 * context must not carry dependencies, build output or git. Beside the base patterns it lists the
 * per-machine files of every agent, the ones `sync` keeps in `.git/info/exclude`, so a build
 * never depends on which agents a developer chose.
 */
export const renderDockerignore = (): string => {
  const agentPaths = excludePathsOf({
    agents: readAgentTable().map(entry => entry.id),
    skillNames: shippedSkillNames(),
  })
    .flatMap(group => group.paths)
    .map(path => path.replace(/^\//, '').replace(/\/$/, ''));
  const patterns = [...new Set([...BASE_PATTERNS, ...agentPaths])];

  return [
    '# Written by vulcan init; edit it freely, vulcan never overwrites it. .git is excluded, so pass the commit: docker build --build-arg APP_BUILD_COMMIT="$(git rev-parse HEAD)" ...',
    ...patterns,
    '',
  ].join('\n');
};
