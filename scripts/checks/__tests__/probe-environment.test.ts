import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'probe-environment.yml',
);

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

// The probe holds the release environment, so it is held to what makes it safe: it can be started by hand, it has no
// permission, no secret, no action and no checkout, so a run that the environment lets through still does nothing.
describe('the temporary environment probe touches nothing', () => {
  const text = readFileSync(FILE, 'utf8');
  const workflow = { value: Bun.YAML.parse(text) };

  test('it is started by hand only, with no permission at all', () => {
    const triggers = { value: isRecord(workflow) ? workflow.value['on'] : undefined };

    expect(isRecord(triggers) ? Object.keys(triggers.value) : []).toEqual(['workflow_dispatch']);
    expect(isRecord(workflow) ? workflow.value['permissions'] : undefined).toEqual({});
  });

  test('its one job names the release environment and echoes where it ran', () => {
    const jobs = { value: isRecord(workflow) ? workflow.value['jobs'] : undefined };
    const probe = { value: isRecord(jobs) ? jobs.value['probe'] : undefined };

    expect(isRecord(probe) ? probe.value['environment'] : undefined).toBe('npm-release');
    expect(text).toContain('echo "probe: this job ran');
  });

  test('no secret, no action, no checkout, no package manager, no publish (in the code, not the comments)', () => {
    const code = text
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');

    for (const forbidden of [
      'secrets.',
      'uses:',
      'checkout',
      'bun ',
      'npm ',
      'publish',
      'GITHUB_TOKEN',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });
});
