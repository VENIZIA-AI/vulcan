import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';

const ROOT = join(import.meta.dir, '..', '..', '..');
const HOOK = join(ROOT, 'packages', 'cli', 'base', 'hooks', 'guard-writes.ts');

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

/** What the shipped guard-writes hook answers for a command in this repository: its decision and the first reason line. */
const decide = (opts: { command: string }): { decision?: string; reason: string } => {
  const result = spawnSyncBounded({
    cmd: ['bun', HOOK],
    cwd: ROOT,
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
    stdin: new Blob([
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: opts.command }, cwd: ROOT }),
    ]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const text = result.stdout.toString().trim();

  if (text.length === 0) {
    return { reason: '' };
  }

  const parsed = { value: JSON.parse(text) };
  const output = { value: isRecord(parsed) ? parsed.value['hookSpecificOutput'] : undefined };
  const decision = isRecord(output) ? output.value['permissionDecision'] : undefined;
  const reason = isRecord(output) ? output.value['permissionDecisionReason'] : undefined;

  return {
    decision: typeof decision === 'string' ? decision : undefined,
    reason: typeof reason === 'string' ? reason : '',
  };
};

describe('this repository asks before an agent approves a deployment or writes a secret or a setting', () => {
  test.each([
    [
      'approving a waiting deployment',
      'gh api -X POST repos/o/r/actions/runs/9/pending_deployments -f state=approved',
    ],
    [
      'approving with the body flag alone (an implicit POST)',
      'gh api repos/o/r/actions/runs/9/pending_deployments -f state=approved',
    ],
    ['writing an environment', 'gh api repos/o/r/environments/npm-release -X PUT'],
    [
      'writing an environment from a file',
      'gh api repos/o/r/environments/npm-release --input env.json',
    ],
    ['deleting an Actions secret', 'gh api -X DELETE repos/o/r/actions/secrets/NPM_ACCESS_TOKEN'],
    ['writing a ruleset', 'gh api repos/o/r/rulesets --input ruleset.json'],
    [
      'writing a branch protection',
      'gh api repos/o/r/branches/develop/protection -X PUT -f required_status_checks=null',
    ],
    [
      'changing the workflow token permission',
      'gh api repos/o/r/actions/permissions/workflow -X PUT -f default_workflow_permissions=read',
    ],
    [
      'changing a collaborator role',
      'gh api repos/o/r/collaborators/someone -X PUT -f permission=admin',
    ],
    ['gh secret set', 'gh secret set ATLAS_INDEX_KEY < key'],
    ['gh secret delete', 'gh secret delete NPM_ACCESS_TOKEN'],
    ['gh variable set', 'gh variable set X --body 1'],
    [
      'inside cd and &&',
      'cd x && gh api -f state=approved repos/o/r/actions/runs/9/pending_deployments',
    ],
    ['inside bash -c', 'bash -c "gh secret set X"'],
    ['under sudo', 'sudo gh secret delete X'],
    [
      'with the flag first and mixed case',
      'GH API -x delete repos/o/r/rulesets/5'.replace('GH API', 'gh api'),
    ],
  ])('%s asks, and names V-W-03', (_label, command) => {
    const answer = decide({ command });

    expect(answer.decision).toBe('ask');
    expect(answer.reason).toContain('V-W-03');
  });

  test.each([
    ['listing environments', 'gh api repos/o/r/environments'],
    ['listing secret names', "gh api repos/o/r/actions/secrets --jq '.secrets[].name'"],
    [
      'reading collaborators',
      'gh api "repos/o/r/collaborators?per_page=100&permission=push" --jq length',
    ],
    ['reading rulesets', 'gh api repos/o/r/rulesets'],
    ['reading a branch protection', 'gh api repos/o/r/branches/develop/protection'],
    ['listing secrets with gh', 'gh secret list'],
    ['a pull request merge', 'gh pr merge 5 --delete-branch'],
    ['opening an issue', 'gh issue create --title t --body b'],
    [
      'a write to something else (a pull request)',
      'gh api repos/o/r/pulls -f title=t -f head=h -f base=b',
    ],
    ['naming an endpoint in a search', 'rg "pending_deployments" docs'],
    ['a commit message naming it', 'git log --grep "rulesets" --oneline'],
    ['the release dry run', 'make release-plan ARGS="--bump patch"'],
  ])('%s asks nothing', (_label, command) => {
    expect(decide({ command }).decision).toBeUndefined();
  });
});
