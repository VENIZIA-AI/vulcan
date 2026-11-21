import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { CodemodRunner } from '@/common/codemod-runner';
import { AtlasGit } from '@/common/constants';
import { MigrateDirections } from './directions';
import type { TStepDirection } from './directions';
import { MIGRATION_NAME_PATTERN } from './schema';
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

/**
 * The direction of a step. The plan is JSON from the running server, which may be older than this command and send no
 * direction on a step: then the step goes the way the plan does, as it always did.
 */
const directionOf = (opts: { step: IMigrationStep; plan: IMigrationPlan }): TStepDirection => {
  const given: TStepDirection | undefined = opts.step.direction;

  if (given !== undefined) {
    return given;
  }

  return opts.plan.direction === MigrateDirections.DOWNGRADE
    ? MigrateDirections.DOWNGRADE
    : MigrateDirections.UPGRADE;
};

/** A step of a plan is told apart by its item and its direction: a changed item is undone as it was, then applied as it is. */
const stepKeyOf = (opts: { step: IMigrationStep; plan: IMigrationPlan }): string =>
  `${opts.step.entry}#${opts.step.id}#${directionOf(opts)}`;

interface ICodemodOutcome {
  codemod: string;
  direction: TStepDirection;
  steps: IMigrationStep[];
  status: string;
  output: string;
  /** What was run, as the source's runner words and the arguments: `<runner> <name> . --write`. */
  command: string;
}

/**
 * The first directory from `directory` whose `node_modules/.bin` holds `name` up to the app's git work tree root (a workspace
 * installs it at the root, not beside each app). Outside git only `directory` itself is searched: a
 * binary of an unrelated parent folder is never run.
 */
const holderOf = (opts: { directory: string; name: string }): string | undefined => {
  const toplevel = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: opts.directory,
    encoding: 'utf8',
    env: AtlasGit.buildEnvironment(),
  });
  const top = toplevel.status === 0 ? realpathSync(toplevel.stdout.trim()) : undefined;
  let directory = realpathSync(opts.directory);

  for (;;) {
    if (existsSync(CodemodRunner.binaryIn({ directory, name: opts.name }))) {
      return directory;
    }

    const parent = dirname(directory);

    if (top === undefined || directory === top || parent === directory) {
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

/** The codemods of a plan, each once per direction, in the order their first step applies: a rollback of a name is not its rewrite. */
const codemodsOf = (opts: {
  plan: IMigrationPlan;
}): { codemod: string; direction: TStepDirection; steps: IMigrationStep[] }[] => {
  const found: { codemod: string; direction: TStepDirection; steps: IMigrationStep[] }[] = [];

  for (const step of opts.plan.steps) {
    if (step.codemod === undefined) {
      continue;
    }

    const direction = directionOf({ step, plan: opts.plan });
    const known = found.find(
      (entry) => entry.codemod === step.codemod && entry.direction === direction,
    );

    if (known === undefined) {
      found.push({ codemod: step.codemod, direction, steps: [step] });
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
        .flatMap((outcome) => outcome.steps.map((step) => stepKeyOf({ step, plan }))),
    );
    const manual = plan.steps.filter((step) => !done.has(stepKeyOf({ step, plan })));

    lines.push(`## ${plan.package}: ${plan.from} to ${plan.to} (${plan.direction})`, '');

    if (outcomes.length === 0) {
      lines.push('No codemod is linked: nothing was rewritten.', '');
    }

    for (const outcome of outcomes) {
      lines.push(
        `${outcome.status === CodemodStatuses.RAN ? 'Ran' : `Did not run (${outcome.status}):`} \`${outcome.codemod}\`${outcome.direction === MigrateDirections.DOWNGRADE ? ' in reverse' : ''} for ${outcome.steps.map((step) => step.id).join(', ')}.`,
      );

      if (outcome.command.length > 0) {
        lines.push('', `Command: \`${outcome.command}\``);
      }

      if (outcome.output.length > 0) {
        lines.push('', '```text', trimmed({ text: outcome.output }), '```');
      }

      lines.push('');
    }

    // A codemod that exits 0 may only list places or leave some behind, so its step's text is still printed.
    for (const step of plan.steps.filter((entry) => done.has(stepKeyOf({ step: entry, plan })))) {
      lines.push(
        `#### ${step.id}`,
        '',
        'After the codemod, check each place it listed:',
        '',
        ...MigrateReport.changeLines({ change: step.change }),
      );

      if (step.data !== undefined) {
        lines.push('', `Check after the codemod, \`${step.id}\`: ${step.data}`);
      }

      lines.push('');
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
 * The words that run a plan's codemods: the `knowledge.codemodCommand` of the source that serves its package, checked again
 * here (the plan reaches this process as JSON), else the default. A word that is not allowed throws.
 */
const runnerOf = (opts: { plan: IMigrationPlan }): string[] => {
  const words = CodemodRunner.wordsOf({
    value: opts.plan.codemodCommand,
    label: `the plan for ${opts.plan.package}`,
  });

  return words.length === 0 ? [...CodemodRunner.DEFAULT] : words;
};

/**
 * Runs the codemods a plan links, in plan order and once each, as `<runner> <name> . --write`
 * (`--reverse` for a rollback), the runner being the source project's `knowledge.codemodCommand` (default `devz codemod`), then prints the steps that stay manual. It rewrites nothing itself,
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
    // A source that was not served may hold steps this plan lacks: the rewrite waits for the whole plan, or for --force.
    if (result.notServed !== undefined && !opts.force) {
      opts.err(
        `vulcan migrate apply: ${result.notServed.message}; the plan may be incomplete, so nothing was run - serve the source and plan again, or pass --force\n`,
      );

      return 1;
    }

    const behind = result.plans.find((plan) => plan.behind !== undefined);

    if (behind?.behind !== undefined && !opts.force) {
      opts.err(
        `vulcan migrate apply: ${behind.package}: ${behind.behind}; nothing was run - or pass --force\n`,
      );

      return 1;
    }

    // A plan whose folder state could not be read exactly may name the wrong steps, and a codemod rewrites the app.
    const degraded = result.plans.find((plan) => plan.degraded === true);

    if (degraded !== undefined && !opts.force) {
      opts.err(
        `vulcan migrate apply: ${degraded.package}: the folder state could not be read exactly (${degraded.note ?? 'see the plan'}); the steps may be wrong, so nothing was run - or pass --force\n`,
      );

      return 1;
    }

    const planned = result.plans.map((plan) => ({ plan, codemods: codemodsOf({ plan }) }));

    if (planned.every((entry) => entry.codemods.length === 0)) {
      opts.out(reportOf({ result, outcomes }));

      return 0;
    }

    // A codemod name reaches a command line: a table that is not schema-checked is checked here, before anything runs.
    const badName = planned
      .flatMap((entry) => entry.codemods)
      .find((entry) => !MIGRATION_NAME_PATTERN.test(entry.codemod));

    if (badName !== undefined) {
      opts.err(
        `vulcan migrate apply: codemod name '${badName.codemod}' is not lower-case words joined by -; refusing to run it\n`,
      );

      return 1;
    }

    const refusal = opts.force ? undefined : refusalOf({ app: result.app });

    if (refusal !== undefined) {
      opts.err(`vulcan migrate apply: ${refusal}\n`);

      return 1;
    }

    const runners = new Map<IMigrationPlan, { bin: string; name: string; words: string[] }>();
    const missing: string[] = [];
    const refused: string[] = [];

    for (const { plan, codemods } of planned) {
      if (codemods.length === 0) {
        continue;
      }

      let words: string[];

      try {
        words = runnerOf({ plan });
      } catch (error) {
        opts.err(
          `vulcan migrate apply: ${error instanceof Error ? error.message : String(error)}; refusing to run it\n`,
        );

        return 1;
      }

      const holder = holderOf({ directory: result.app, name: words[0] });

      if (holder === undefined) {
        missing.push(words[0]);

        continue;
      }

      const notRunnable = CodemodRunner.refusalOf({
        directory: holder,
        name: words[0],
        packages: plan.codemodPackages ?? [],
      });

      if (notRunnable === undefined) {
        runners.set(plan, {
          bin: CodemodRunner.binaryIn({ directory: holder, name: words[0] }),
          name: words[0],
          words: words.slice(1),
        });
      } else {
        refused.push(notRunnable);
      }
    }

    if (refused.length > 0) {
      opts.err(`vulcan migrate apply: ${refused.join('; ')}; the steps below stay manual\n`);
      opts.out(reportOf({ result, outcomes }));

      return 1;
    }

    if (missing.length > 0) {
      opts.err(
        `vulcan migrate apply: ${[...new Set(missing)].join(', ')} is not installed in ${result.app} or above it (the codemod runner of the source); the steps below stay manual\n`,
      );
      opts.out(reportOf({ result, outcomes }));

      return 1;
    }

    let failed = false;

    for (const { plan, codemods } of planned) {
      outcomes[plan.package] = [];

      const runner = runners.get(plan);

      for (const { codemod, direction, steps } of codemods) {
        const outcome: ICodemodOutcome = {
          codemod,
          direction,
          steps,
          status: CodemodStatuses.NOT_RUN,
          output: '',
          command: '',
        };

        outcomes[plan.package].push(outcome);

        if (failed) {
          continue;
        }

        if (runner === undefined) {
          continue;
        }

        const args = [...runner.words, codemod, '.', '--write'];

        if (direction === MigrateDirections.DOWNGRADE) {
          args.push('--reverse');
        }

        outcome.command = [runner.name, ...args].join(' ');

        const ran = spawnSync(runner.bin, args, {
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
