import { AtlasConstants } from '@/common';
import type { IToolHandler } from '@/protocol/common';
import { RpcError, RpcErrorCodes } from '@/protocol/common';
import type { ISymbolIndex, ISymbolRecord } from '@/symbols';
import { SymbolIntent } from '@/symbols';
import { z } from 'zod';
import { IntentInputSchema, ToolInput, ToolTriggers } from './common';

const DESCRIPTION =
  'Finds the export that already does what you need, from the need in plain words ("wait 500 ms", "react to a ' +
  'media query"). Each hit has the ready `import` line, the `signature`, when to use it (`useWhen`), what it ' +
  'replaces (`insteadOf`), the first `example`, and the `file`:`line`. A miss says so and names the closest ' +
  'exports by name; it is never a guess. Follow a hit with `symbol` for the full declaration.';

const INPUT_JSON_SCHEMA = z.toJSONSchema(IntentInputSchema);
const DEFAULT_LIMIT = 5;
const TYPE_KINDS = new Set(['interface', 'type', 'type alias', 'type-alias']);

interface IIntentHitReply {
  name: string;
  import: string;
  specifier: string;
  signature: string;
  useWhen?: string;
  insteadOf?: string;
  example?: string;
  file: string;
  line: number;
  source?: string;
  /** The package is not installed in the project: the hit comes from the newest published release. */
  notInstalled?: true;
}

const importLine = (opts: { record: ISymbolRecord }): string =>
  `import ${TYPE_KINDS.has(opts.record.kind) ? 'type ' : ''}{ ${opts.record.name} } from '${opts.record.specifier}';`;

const replyOf = (opts: {
  record: ISymbolRecord;
  tags: ReturnType<typeof SymbolIntent.tagsOf>;
}): IIntentHitReply => ({
  name: opts.record.name,
  import: importLine({ record: opts.record }),
  specifier: opts.record.specifier,
  signature: opts.record.signature,
  ...opts.tags,
  file: opts.record.file,
  line: opts.record.line,
  ...(opts.record.source === undefined ? {} : { source: opts.record.source }),
  ...(opts.record.origin !== undefined && opts.record.origin.installedAt === undefined
    ? { notInstalled: true as const }
    : {}),
});

/** The example goes first when the answer is over the budget, then the last hits; one hit always stays. */
const withinBudget = (opts: { hits: IIntentHitReply[] }): IIntentHitReply[] => {
  let hits = opts.hits.map((hit) => ({ ...hit }));
  const isOver = (): boolean => JSON.stringify(hits).length > AtlasConstants.SEARCH_BUDGET_CHARS;

  for (let at = hits.length - 1; at >= 0 && isOver(); at -= 1) {
    delete hits[at].example;
  }

  while (isOver() && hits.length > 1) {
    hits = hits.slice(0, -1);
  }

  return hits;
};

export class IntentTool {
  static build(opts: { symbols: ISymbolIndex; projects?: string }): IToolHandler {
    return {
      definition: {
        name: 'intent',
        description: `${ToolTriggers.intent({ projects: opts.projects })} ${DESCRIPTION}`,
        inputSchema: INPUT_JSON_SCHEMA,
      },
      call: async ({ args }) => {
        const input = ToolInput.parse({ schema: IntentInputSchema, args });

        if (opts.symbols.isEmpty()) {
          throw new RpcError({
            code: RpcErrorCodes.INVALID_PARAMS,
            message: opts.symbols.emptyReason,
          });
        }

        const records = opts.symbols
          .all()
          .filter((record) => input.source === undefined || record.source === input.source)
          .filter((record) => input.package === undefined || record.package === input.package);
        const ranked = SymbolIntent.rank({
          records,
          query: input.query,
          limit: input.limit ?? DEFAULT_LIMIT,
        });

        if (ranked.length === 0) {
          return {
            query: input.query,
            hits: [],
            closest: SymbolIntent.tokensOf({ text: input.query })
              .flatMap((word) => opts.symbols.suggest({ name: word, limit: 3 }))
              .filter((name, at, all) => all.indexOf(name) === at)
              .slice(0, 5),
          };
        }

        return {
          query: input.query,
          hits: withinBudget({ hits: ranked.map((hit) => replyOf(hit)) }),
        };
      },
    };
  }
}
