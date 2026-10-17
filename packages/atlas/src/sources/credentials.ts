import { spawnSync } from 'node:child_process';

/**
 * The token for a private repository on the tarball path: `GITHUB_TOKEN`, else what `gh auth token`
 * prints. Git, when present, uses the machine's own credentials instead. A token never appears in a
 * message or a log - only in a request header.
 */
export const githubTokenOf = (): string | undefined => {
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  const printed = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });

  return printed.status === 0 && printed.stdout.trim().length > 0
    ? printed.stdout.trim()
    : undefined;
};
