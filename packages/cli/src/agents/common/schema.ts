import { z } from 'zod';
import { AgentConstants, AgentGuardKinds, AgentRenderers, AgentScopes } from './constants.ts';

/** One agent of `base/agents.json`: strict, so a typo in the table is an error, not a silent gap. */
export const AGENT_ENTRY_SCHEMA = z
  .strictObject({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name: z.string().min(1),
    detect: z.strictObject({
      binaries: z.array(z.string()),
      homeDirs: z.array(z.string()),
      projectDirs: z.array(z.string()),
    }),
    instructions: z.strictObject({
      nativeAgentsMd: z.boolean(),
      shim: z.strictObject({ path: z.string(), content: z.string() }).nullable(),
    }),
    mcp: z.strictObject({
      scope: z.string().refine((value) => AgentScopes.isValid(value), {
        message: `one of: ${[...AgentScopes.SCHEME_SET].join(', ')}`,
      }),
      path: z.string().min(1),
      renderer: z.string().refine((value) => AgentRenderers.isValid(value), {
        message: `one of: ${[...AgentRenderers.SCHEME_SET].join(', ')}`,
      }),
    }),
    skills: z.strictObject({ dir: z.string().min(1) }),
    /** How the guards reach this agent; `null` where nothing is wired (Claude has its own hooks in settings.json). */
    guards: z
      .strictObject({
        kind: z.string().refine((value) => AgentGuardKinds.isValid(value), {
          message: `one of: ${[...AgentGuardKinds.SCHEME_SET].join(', ')}`,
        }),
        path: z.string().min(1),
      })
      .nullable(),
    instructionsSurfaced: z.union([z.boolean(), z.literal('partial'), z.null()]),
    notes: z.array(z.string()),
  })
  .superRefine((entry, context) => {
    if (
      entry.mcp.scope === AgentScopes.SHARED &&
      entry.mcp.path !== AgentConstants.SHARED_MCP_FILE
    ) {
      context.addIssue({
        code: 'custom',
        path: ['mcp', 'path'],
        message: `a shared entry points at ${AgentConstants.SHARED_MCP_FILE}`,
      });
    }
  });
