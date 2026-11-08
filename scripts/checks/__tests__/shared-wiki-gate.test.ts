import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const read = (opts: { path: string }): string => readFileSync(join(ROOT, opts.path), 'utf8');

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

/** The `run` lines of the steps of one job of the release workflow, in order. */
const runsOf = (opts: { job: string }): string[] => {
  const workflow = {
    value: Bun.YAML.parse(read({ path: '.github/workflows/package-release.yml' })),
  };
  const jobs = { value: isRecord(workflow) ? workflow.value['jobs'] : undefined };
  const job = { value: isRecord(jobs) ? jobs.value[opts.job] : undefined };
  const steps = isRecord(job) ? job.value['steps'] : undefined;

  return Array.isArray(steps)
    ? steps.map((step: unknown) => {
        const entry = { value: step };
        const run = isRecord(entry) ? entry.value['run'] : undefined;

        return typeof run === 'string' ? run : '';
      })
    : [];
};

describe('the shared wiki theme is checked by the release, and the rule that allows it says so', () => {
  test('the release gates job runs make wiki-shared-check, after lint and before the tests', () => {
    const runs = runsOf({ job: 'test' });
    const at = runs.indexOf('make wiki-shared-check');

    expect(at).toBeGreaterThan(runs.indexOf('make lint-all'));
    expect(at).toBeLessThan(runs.indexOf('make test'));
  });

  test('the make target compares against the published copies unless ARGS names checkouts, and is listed in help', () => {
    const make = read({ path: 'make/lint.mk' });

    expect(make).toMatch(
      /^wiki-shared-check:\n(?:.*\n)*?\t@bun scripts\/wiki-shared\/check\.ts \$\(or \$\(ARGS\),--remote\)/m,
    );
    expect(read({ path: 'make/help.mk' })).toContain('"wiki-shared-check"');
  });

  test('V-C-13 allows an exception the project names, and this project names the shared theme as C-21', () => {
    expect(read({ path: 'packages/cli/base/rules.md' })).toMatch(
      /\| V-C-13 \|.*no custom components or theme CSS\) unless the project's own rules name an exception/,
    );

    const own = read({ path: '.agents/rules.md' });

    expect(own).toMatch(/\| \*\*C-21\*\* \|.*docs\/wiki\/site\/\.vitepress\/theme\/shared/);
    expect(own).toContain('make wiki-shared-check');
  });
});
