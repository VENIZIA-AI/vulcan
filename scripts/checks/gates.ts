/**
 * `make gates`: the checks CI runs, in CI's order, one after another, each by make's own exit status.
 * The list is read from `.github/workflows/ci.yml`, so it cannot drift from CI: a `make` line of any job there is a gate here.
 *
 *   make gates                      # run them, stop at the first that fails
 *   make gates ARGS="--keep-going"  # run them all, report every failure
 *   make gates ARGS="--list"        # print them, run nothing
 *
 * A pipe to `tail` or `grep` reports the pipe's status, not make's; this runs make directly.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TAIL_LINES = 40;
const ROOT = resolve(import.meta.dir, '..', '..');
const CI_FILE = join(ROOT, '.github', 'workflows', 'ci.yml');

export interface IGateCommand {
  step: string;
  targets: string[];
}

export interface IGateResult extends IGateCommand {
  code: number;
  tail: string;
}

const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

/** The `make` commands of every job of the workflow, in the order of the file, one per line, the targets as separate words. */
export const commandsOf = (opts: { text: string }): IGateCommand[] => {
  const workflow = { value: Bun.YAML.parse(opts.text) };
  const jobs = { value: isRecord(workflow) ? workflow.value['jobs'] : undefined };

  if (!isRecord(jobs)) {
    return [];
  }

  return Object.values(jobs.value).flatMap((job) => {
    const holder = { value: job };
    const steps = isRecord(holder) ? holder.value['steps'] : undefined;

    return Array.isArray(steps)
      ? steps.flatMap((step): IGateCommand[] => {
          const entry = { value: step };
          const run = isRecord(entry) ? entry.value['run'] : undefined;
          const name = isRecord(entry) ? entry.value['name'] : undefined;

          return typeof run === 'string'
            ? run
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.startsWith('make '))
                .map((line) => ({
                  step: typeof name === 'string' ? name : line,
                  targets: line.slice('make '.length).trim().split(/\s+/),
                }))
            : [];
        })
      : [];
  });
};

/** Runs the commands in order; stops at the first failure unless `keepGoing`. A make that cannot start is a failure. */
export const runGates = (opts: {
  commands: IGateCommand[];
  run: (command: IGateCommand) => { code: number; tail: string };
  keepGoing: boolean;
  onResult?: (result: IGateResult) => void;
}): IGateResult[] => {
  const results: IGateResult[] = [];

  for (const command of opts.commands) {
    let outcome: { code: number; tail: string };

    try {
      outcome = opts.run(command);
    } catch (error) {
      outcome = { code: 127, tail: error instanceof Error ? error.message : String(error) };
    }

    const result = { ...command, ...outcome };

    results.push(result);
    opts.onResult?.(result);

    if (result.code !== 0 && !opts.keepGoing) {
      break;
    }
  }

  return results;
};

const runMake = (command: IGateCommand): { code: number; tail: string } => {
  const scratch = process.env.TMPDIR ?? join(ROOT, '.agents', 'local', 'tmp');

  mkdirSync(scratch, { recursive: true });

  const result = Bun.spawnSync(['make', ...command.targets], {
    cwd: ROOT,
    env: { ...process.env, TMPDIR: scratch },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = `${result.stdout.toString()}${result.stderr.toString()}`.trimEnd().split('\n');

  return { code: result.exitCode ?? 1, tail: output.slice(-TAIL_LINES).join('\n') };
};

const main = (): number => {
  const args = process.argv.slice(2);
  const commands = commandsOf({ text: readFileSync(CI_FILE, 'utf8') });

  if (args.includes('--list')) {
    for (const command of commands) {
      console.log(`${command.step}: make ${command.targets.join(' ')}`);
    }

    return 0;
  }

  const results = runGates({
    commands,
    keepGoing: args.includes('--keep-going'),
    run: runMake,
    onResult: (result) => {
      console.log(
        `gates: ${result.step}: make ${result.targets.join(' ')} -> ${result.code === 0 ? 'ok' : `FAILED (exit ${result.code})`}`,
      );

      if (result.code !== 0) {
        console.log(result.tail);
      }
    },
  });
  const failed = results.filter((result) => result.code !== 0);

  console.log(
    `gates: ${results.length - failed.length} of ${commands.length} passed${failed.length > 0 ? `, failed: ${failed.map((result) => result.step).join(', ')}` : ''}${results.length < commands.length && failed.length > 0 ? `, ${commands.length - results.length} not run` : ''}`,
  );

  return failed.length === 0 && results.length === commands.length ? 0 : 1;
};

if (import.meta.main) {
  process.exit(main());
}
