import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { ExitCodes } from '../common/index.ts';
import type { ICommandContext } from '../common/index.ts';
import { AgentSignaturePolicies, CommitCheckFlags } from './common/index.ts';
import type { ICommentStyle, ICommitPolicy } from './common/index.ts';
import { CommitMessage } from './message.ts';
import { CommitPolicy } from './policy.ts';
import { AgentSignature } from './signature.ts';
import { SubjectShape } from './subject.ts';

const USAGE = `usage: vulcan commit-check <message-file> | ${CommitCheckFlags.RANGE} <revs> | ${CommitCheckFlags.TEXT} <message>`;

interface ICheckedMessage {
  label: string;
  message: string;
}

type TSource =
  | { kind: 'file'; value: string }
  | { kind: 'text'; value: string }
  | { kind: 'range'; value: string };

type TMessages = { ok: true; messages: ICheckedMessage[] } | { ok: false; error: string };

export class CommitCheck {
  static async run(opts: ICommandContext): Promise<number> {
    const source = CommitCheck.sourceOf({ args: opts.args });

    if (source === undefined) {
      process.stderr.write(`commit-check: ${USAGE}\n`);

      return ExitCodes.USAGE;
    }

    const input = CommitCheck.readMessages({ cwd: opts.cwd, source });

    if (!input.ok) {
      process.stderr.write(`commit-check: ${input.error}\n`);

      return ExitCodes.USAGE;
    }

    const policy = CommitPolicy.read({ root: opts.cwd });

    if (policy === undefined) {
      process.stderr.write(
        'commit-check: no commit check is configured (commit.message in .configs/vulcan.config.mts); nothing checked\n',
      );

      return ExitCodes.OK;
    }

    const comment = CommitMessage.commentStyleOf({ cwd: opts.cwd });
    const problems = input.messages.flatMap((checked) =>
      CommitCheck.problemsOf({ checked, policy, comment }),
    );

    if (problems.length === 0) {
      return ExitCodes.OK;
    }

    process.stderr.write(
      `commit-check: ${problems.length} problem(s) in the commit message:\n${problems.join('\n')}\n`,
    );

    return ExitCodes.FAILURE;
  }

  private static sourceOf(opts: { args: string[] }): TSource | undefined {
    const [first, second, ...rest] = opts.args;

    if (first === CommitCheckFlags.TEXT && second !== undefined && rest.length === 0) {
      return { kind: 'text', value: second };
    }

    if (first === CommitCheckFlags.RANGE && second !== undefined && rest.length === 0) {
      return { kind: 'range', value: second };
    }

    return first !== undefined && !first.startsWith('--') && second === undefined
      ? { kind: 'file', value: first }
      : undefined;
  }

  private static problemsOf(opts: {
    checked: ICheckedMessage;
    policy: ICommitPolicy;
    comment: ICommentStyle;
  }): string[] {
    const { checked, policy, comment } = opts;
    const signed =
      policy.agentSignature === AgentSignaturePolicies.DENY
        ? AgentSignature.find({ message: checked.message, agents: policy.agents, comment }).map(
            (hit) =>
              `  ${checked.label} line ${hit.line}: "${hit.text}" signs the commit as an agent; remove the line`,
          )
        : [];
    const shape =
      policy.subject === undefined
        ? undefined
        : SubjectShape.problemOf({ message: checked.message, subject: policy.subject, comment });

    return shape === undefined
      ? signed
      : [
          ...signed,
          `  ${checked.label} line ${shape.line}: "${shape.text}" does not match the shape ${policy.subject?.pattern}${shape.hint === undefined ? '' : ` (${shape.hint})`}`,
        ];
  }

  private static readMessages(opts: { cwd: string; source: TSource }): TMessages {
    const { kind, value } = opts.source;

    if (kind === 'text') {
      return { ok: true, messages: [{ label: 'message,', message: value }] };
    }

    if (kind === 'range') {
      return CommitCheck.readRange({ cwd: opts.cwd, range: value });
    }

    try {
      return {
        ok: true,
        messages: [{ label: 'commit message,', message: readFileSync(value, 'utf8') }],
      };
    } catch (error) {
      return {
        ok: false,
        error: `cannot read ${value}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private static readRange(opts: { cwd: string; range: string }): TMessages {
    const result = spawnSync(
      'git',
      ['log', '--format=%h%x01%B%x00', '--end-of-options', opts.range],
      { cwd: opts.cwd, encoding: 'utf8' },
    );

    if (result.status !== 0) {
      return { ok: false, error: `git log ${opts.range} failed: ${result.stderr.trim()}` };
    }

    return {
      ok: true,
      messages: result.stdout
        .split('\x00')
        .map((chunk) => chunk.replace(/^\n/, ''))
        .filter((chunk) => chunk.trim() !== '')
        .map((chunk) => {
          const [id, ...body] = chunk.split('\x01');

          return { label: `commit ${id},`, message: body.join('\x01') };
        }),
    };
  }
}
