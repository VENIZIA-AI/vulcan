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
 * `.env` files hold secrets (database passwords, tokens) and a Dockerfile that copies the project
 * would put them in a layer a CI cache can keep. The example file stays: the negation comes after
 * the excludes, or Docker would not apply it.
 */
const SECRET_PATTERNS = ['**/.env', '**/.env.*', '!**/.env.example'];
const SECRET_COMMENT =
  '# .env files hold secrets: keep them out of every image layer; the example stays.';

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
  const patterns = [...new Set([...BASE_PATTERNS, ...SECRET_PATTERNS, ...agentPaths])];

  return [
    '# Written by vulcan init; edit it freely, vulcan never overwrites it. .git is excluded, so pass the commit: docker build --build-arg APP_BUILD_COMMIT="$(git rev-parse HEAD)" ...',
    ...patterns.flatMap(pattern =>
      pattern === SECRET_PATTERNS[0] ? [SECRET_COMMENT, pattern] : [pattern],
    ),
    '',
  ].join('\n');
};
