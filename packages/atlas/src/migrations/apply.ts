import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AtlasGit } from '@/common/constants';
import { MigrateDirections } from './plan';
import type { IMigrationPlan, IMigrationResult, IMigrationStep } from './plan';
import { MigrateReport } from './report';

const DEVZ_TIMEOUT_MS = 10 * 60 * 1000;
const NOT_REVERSIBLE_EXIT = 2;
const NOT_REVERSIBLE_TEXT = 'not reversible';
const OUTPUT_LINES_MAX = 30;

class CodemodStatuses {
  static readonly RAN = 'ran';
  static readonly NOT_REVERSIBLE = 'not reversible';
  static readonly FAILED = 'failed';
  static readonly NOT_RUN = 'not run';
}

interface ICodemodOutcome {
  codemod: string;
  steps: IMigrationStep[];
  status: string;
  output: string;
}

/** The first `node_modules/.bin/devz` from `directory` up: a workspace installs it at the root, not beside each app. */
const devzFrom = (opts: { directory: string }): string | undefined => {
  let directory = opts.directory;

  for (;;) {
    const candidate = join(directory, 'node_modules', '.bin', 'devz');

    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(directory);

    if (parent === directory) {
      return undefined;
    }

    directory = parent;
  }
};

/** Why the app's code may not be rewritten: no git to undo it, or changes of its own that a rewrite would mix with. */
const refusalOf = (opts: { app: string }): string | undefined => {
  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: opts.app,
    encoding: 'utf8',
    env: AtlasGit.buildEnvironment(),
  });

  if (status.status !== 0) {
    return `${opts.app} is not inside a git work tree, so a rewrite could not be undone; commit it under git, or pass --force`;
  }

  return status.stdout.trim().length > 0
    ? `${opts.app} has uncommitted changes; commit or stash them so the rewrite is a diff of its own, or pass --force`
    : undefined;
};

const trimmed = (opts: { text: string }): string => {
  const lines = opts.text.trim().split('\n');

  return lines.length <= OUTPUT_LINES_MAX
    ? lines.join('\n')
    : [
        ...lines.slice(0, OUTPUT_LINES_MAX),
        `... ${lines.length - OUTPUT_LINES_MAX} more lines`,
      ].join('\n');
};

/** The codemods of a plan, each once, in the order their first step applies. */
const codemodsOf = (opts: {
  plan: IMigrationPlan;
}): { codemod: string; steps: IMigrationStep[] }[] => {
  const found: { codemod: string; steps: IMigrationStep[] }[] = [];

  for (const step of opts.plan.steps) {
    if (step.codemod === undefined) {
      continue;
    }

    const known = found.find((entry) => entry.codemod === step.codemod);

    if (known === undefined) {
      found.push({ codemod: step.codemod, steps: [step] });
    } else {
      known.steps.push(step);
    }
  }

  return found;
};

const reportOf = (opts: {
  result: IMigrationResult;
  outcomes: Record<string, ICodemodOutcome[]>;
}): string => {
  const lines = [`# Migration applied to ${opts.result.app}`, ''];

  for (const plan of opts.result.plans) {
    const outcomes = opts.outcomes[plan.package] ?? [];
    const done = new Set(
      outcomes
        .filter((outcome) => outcome.status === CodemodStatuses.RAN)
        .flatMap((outcome) => outcome.steps.map((step) => step.id)),
    );
    const manual = plan.steps.filter((step) => !done.has(step.id));

    lines.push(`## ${plan.package}: ${plan.from} to ${plan.to} (${plan.direction})`, '');

    if (outcomes.length === 0) {
      lines.push('No codemod is linked: nothing was rewritten.', '');
    }

    for (const outcome of outcomes) {
      lines.push(
        `${outcome.status === CodemodStatuses.RAN ? 'Ran' : `Did not run (${outcome.status}):`} \`${outcome.codemod}\` for ${outcome.steps.map((step) => step.id).join(', ')}.`,
      );

      if (outcome.output.length > 0) {
        lines.push('', '```text', trimmed({ text: outcome.output }), '```');
      }

      lines.push('');
    }

    for (const step of plan.steps.filter(
      (entry) => done.has(entry.id) && entry.data !== undefined,
    )) {
      lines.push(`Check after the codemod, \`${step.id}\`: ${step.data}`, '');
    }

    if (manual.length > 0) {
      lines.push('### Still manual', '');

      for (const step of manual) {
        lines.push(`#### ${step.id}`, '', ...MigrateReport.changeLines({ change: step.change }));

        if (step.data !== undefined) {
          lines.push('', `Data: ${step.data}`);
        }

        lines.push('');
      }
    }

    if (plan.unstructured.length > 0) {
      lines.push(
        '### Breaking changes without structured steps',
        '',
        ...plan.unstructured.map((entry) => `- \`${entry.id}\` (${entry.date}): ${entry.title}`),
        '',
      );
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
};

/**
 * Runs the codemods a plan links, in plan order and once each, as `devz codemod <name> . --write`
 * (`--reverse` for a rollback), then prints the steps that stay manual. It rewrites nothing itself,
 * and it refuses an app git cannot undo unless `force`.
 */
export class MigrateApply {
  static run(opts: {
    result: IMigrationResult;
    force: boolean;
    out: (text: string) => void;
    err: (text: string) => void;
  }): number {
    const { result } = opts;
    const outcomes: Record<string, ICodemodOutcome[]> = {};
    const planned = result.plans.map((plan) => ({ plan, codemods: codemodsOf({ plan }) }));

    if (planned.every((entry) => entry.codemods.length === 0)) {
      opts.out(reportOf({ result, outcomes }));

      return 0;
    }

    const refusal = opts.force ? undefined : refusalOf({ app: result.app });

    if (refusal !== undefined) {
      opts.err(`vulcan migrate apply: ${refusal}\n`);

      return 1;
    }

    const devz = devzFrom({ directory: result.app });

    if (devz === undefined) {
      opts.err(
        `vulcan migrate apply: devz is not installed in ${result.app} or above it (@venizia/dev-configs); the steps below stay manual\n`,
      );
      opts.out(reportOf({ result, outcomes }));

      return 1;
    }

    let failed = false;

    for (const { plan, codemods } of planned) {
      outcomes[plan.package] = [];

      for (const { codemod, steps } of codemods) {
        const outcome: ICodemodOutcome = {
          codemod,
          steps,
          status: CodemodStatuses.NOT_RUN,
          output: '',
        };

        outcomes[plan.package].push(outcome);

        if (failed) {
          continue;
        }

        const args = ['codemod', codemod, '.', '--write'];

        if (plan.direction === MigrateDirections.DOWNGRADE) {
          args.push('--reverse');
        }

        const ran = spawnSync(devz, args, {
          cwd: result.app,
          encoding: 'utf8',
          timeout: DEVZ_TIMEOUT_MS,
          killSignal: 'SIGKILL',
        });
        const text = `${ran.stdout ?? ''}${ran.stderr ?? ''}`;

        outcome.output = ran.status === 0 ? text.trim() : '';

        if (ran.status === 0) {
          outcome.status = CodemodStatuses.RAN;
        } else if (ran.status === NOT_REVERSIBLE_EXIT && text.includes(NOT_REVERSIBLE_TEXT)) {
          outcome.status = CodemodStatuses.NOT_REVERSIBLE;
        } else {
          outcome.status = CodemodStatuses.FAILED;
          failed = true;
          opts.err(
            `vulcan migrate apply: codemod ${codemod} failed (exit ${ran.status ?? 'none'}): ${text.trim()}\n`,
          );
        }
      }
    }

    opts.out(reportOf({ result, outcomes }));

    return failed ? 1 : 0;
  }
}
