import { z } from 'zod';
import { AgentSignaturePolicies } from '../../../commit/common/index.ts';
import type { TAgentSignaturePolicy } from '../../../commit/common/index.ts';
import { SubjectShape } from '../../../commit/subject.ts';

/** A name that holds a letter or a digit: an entry of only punctuation or spaces would match everything. */
const AgentNameSchema = z
  .string()
  .regex(/[\p{L}\p{N}]/u, { message: 'a name with at least one letter or digit' });

export const COMMIT_SECTION = {
  /**
   * What `vulcan check commit` looks for in a commit message, and what `vulcan project sync` installs the
   * `commit-msg` hook for, nested by scope. Every check is off until the project turns it on:
   * `message.agent.signature: 'deny'` rejects a trailer or a "generated with" line that names an agent
   * (rule W-00 of a project that has one); `message.agent.names` adds names to the shipped list and
   * `message.agent.allow` lists names never flagged; `message.subject` is the project's own one-line
   * shape. Written to the manifest only when a check is on.
   */
  commit: z
    .strictObject({
      /** Checks on the text of a commit message: the agent signature policy and the subject shape. */
      message: z
        .strictObject({
          /** Rules about agent names in a commit message: signature policy, extra names and allowed names. */
          agent: z
            .strictObject({
              /** Policy for an agent trailer or "generated with" line in a commit message: `allow` or `deny`; default `allow`. */
              signature: z
                .custom<TAgentSignaturePolicy>(
                  (value) => typeof value === 'string' && AgentSignaturePolicies.isValid(value),
                  { message: `one of ${AgentSignaturePolicies.values().join(', ')}` },
                )
                .default(AgentSignaturePolicies.ALLOW),
              /** Agent names added to the shipped list; a co-author or `Generated with` line naming one is flagged under `deny`. Default `[]`. */
              names: z.array(AgentNameSchema).default([]),
              /** Whole co-author names never flagged, for a person who shares a name with an agent; default `[]`. */
              allow: z.array(AgentNameSchema).default([]),
            })
            .default({ signature: AgentSignaturePolicies.ALLOW, names: [], allow: [] }),
          /** The project's own shape for the commit subject line; absent means no subject check. */
          subject: z
            .strictObject({
              /** Regular expression the commit subject must match, 1 or more characters; an invalid expression is rejected. */
              pattern: z
                .string()
                .min(1)
                .superRefine((value, context) => {
                  const error = SubjectShape.patternError({ pattern: value });

                  if (error !== undefined) {
                    context.addIssue({ code: 'custom', message: error });
                  }
                }),
              /** Text shown with the error when a subject does not match `pattern`; absent means none. */
              hint: z.string().min(1).optional(),
            })
            .optional(),
        })
        .default({ agent: { signature: AgentSignaturePolicies.ALLOW, names: [], allow: [] } }),
    })
    .default({
      message: { agent: { signature: AgentSignaturePolicies.ALLOW, names: [], allow: [] } },
    }),
};
