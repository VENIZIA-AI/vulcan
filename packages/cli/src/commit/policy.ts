import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RecordValue } from '../common/record.ts';
import { CommitAgents } from './agents.ts';
import { AgentSignaturePolicies } from './common/index.ts';
import type { ICommitPolicy, ICommitSubject, TAgentSignaturePolicy } from './common/index.ts';

const MANIFEST_FILE = '.agents/vulcan.manifest.json';

export class CommitPolicy {
  /**
   * The checks the project turned on, from the manifest `vulcan sync` wrote; undefined when the
   * project turned none on, or when the block is not what sync writes (a note says so, and nothing is checked).
   */
  static read(opts: { root: string }): ICommitPolicy | undefined {
    const file = join(opts.root, MANIFEST_FILE);

    if (!existsSync(file)) {
      return undefined;
    }

    let manifest: unknown;

    try {
      manifest = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      console.error(
        `[CommitPolicy.read] ${MANIFEST_FILE} is not JSON | ${error instanceof Error ? error.message : String(error)}`,
      );

      return undefined;
    }

    const commit = RecordValue.isRecord(manifest) ? manifest.commit : undefined;
    const block = RecordValue.isRecord(commit) ? commit.message : undefined;

    if (block === undefined) {
      return undefined;
    }

    const policy = CommitPolicy.parse({ block });

    if (policy === undefined) {
      console.error(
        `[CommitPolicy.read] ignoring commit.message in ${MANIFEST_FILE}: not the shape vulcan sync writes - run vulcan sync`,
      );
    }

    return policy;
  }

  private static parse(opts: { block: unknown }): ICommitPolicy | undefined {
    if (!RecordValue.isRecord(opts.block) || !RecordValue.isRecord(opts.block.agent)) {
      return undefined;
    }

    const { signature, names, allow } = opts.block.agent;
    const { subject } = opts.block;

    if (typeof signature !== 'string' || !AgentSignaturePolicies.isValid(signature)) {
      return undefined;
    }

    const extra = CommitPolicy.namesOf({ value: names });
    const allowed = CommitPolicy.namesOf({ value: allow });

    if (extra === undefined || allowed === undefined) {
      return undefined;
    }

    const shape = CommitPolicy.subjectOf({ value: subject });

    if (subject !== undefined && shape === undefined) {
      return undefined;
    }

    return {
      agentSignature: CommitPolicy.policyOf({ value: signature }),
      agents: CommitAgents.read({ extra, allow: allowed }),
      ...(shape === undefined ? {} : { subject: shape }),
    };
  }

  private static namesOf(opts: { value: unknown }): string[] | undefined {
    if (opts.value === undefined) {
      return [];
    }

    return Array.isArray(opts.value) &&
      opts.value.every((name) => typeof name === 'string' && /[\p{L}\p{N}]/u.test(name))
      ? opts.value
      : undefined;
  }

  private static policyOf(opts: { value: string }): TAgentSignaturePolicy {
    return opts.value === AgentSignaturePolicies.DENY
      ? AgentSignaturePolicies.DENY
      : AgentSignaturePolicies.ALLOW;
  }

  private static subjectOf(opts: { value: unknown }): ICommitSubject | undefined {
    if (!RecordValue.isRecord(opts.value) || typeof opts.value.pattern !== 'string') {
      return undefined;
    }

    const { pattern, hint } = opts.value;

    return typeof hint === 'string' ? { pattern, hint } : { pattern };
  }
}
