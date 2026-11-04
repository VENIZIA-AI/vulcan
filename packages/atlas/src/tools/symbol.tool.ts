import { AtlasConstants } from '@/common';
import { RpcError, RpcErrorCodes } from '@/protocol/common';
import type { IToolHandler } from '@/protocol/common';
import type { IChunkIndex } from '@/search/common';
import type { ISymbolIndex, ISymbolRecord } from '@/symbols';
import { z } from 'zod';
import { SymbolInputSchema, ToolInput, ToolTriggers } from './common';
import { DeclarationReply } from './declaration-reply';
import type { IDeclarationReply } from './declaration-reply';

const DESCRIPTION =
  'Locate one exported symbol by name: which package and import specifier it comes from, its ' +
  'kind, its one-line signature, its `declaration` (the TSDoc and members of the built .d.ts, with ' +
  'the declarations it uses), the source `file` and `line` it is declared on, and the chunk ' +
  'ids that document it. An unknown name is not an error: it answers `matches: []` and up to ' +
  'five `closest` known names.';

// Built once at module load - a guarded tool that re-resolves its store on every call never needs
// to rebuild this.
const INPUT_JSON_SCHEMA = z.toJSONSchema(SymbolInputSchema);

const DOCS_MAX = 5;
const SUGGESTIONS_MAX = 5;

/** One record plus the chunk ids that document it; `docs` is the same list for every match of one name. */
interface ISymbolMatch
  extends Omit<ISymbolRecord, 'declaration' | 'doc' | 'uses'>, Partial<IDeclarationReply> {
  docs: string[];
  /** The specifier of an earlier match that has the same declaration, which is then not repeated. */
  declarationOf?: string;
}

interface ISymbolMatchesResponse {
  matches: ISymbolMatch[];
}

/** A name the store does not hold (in the asked package): no match, and the names it may have meant. */
interface IUnknownSymbolResponse {
  name: string;
  matches: [];
  closest: string[];
}

const matchOf = (opts: { record: ISymbolRecord; docs: string[] }): ISymbolMatch => {
  // `shape` is a digest for the table, not for a client; the declaration is attached after the budget is applied.
  const { record } = opts;

  return {
    source: record.source,
    name: record.name,
    package: record.package,
    subpath: record.subpath,
    specifier: record.specifier,
    kind: record.kind,
    file: record.file,
    line: record.line,
    signature: record.signature,
    external: record.external,
    docs: opts.docs,
  };
};

/** One record answers flat; more than one answers under `matches`, each in the same shape. */
const responseOf = (opts: {
  records: ISymbolRecord[];
  docs: string[];
}): ISymbolMatch | ISymbolMatchesResponse => {
  const matches = opts.records.map((record) => matchOf({ record, docs: opts.docs }));

  return matches.length === 1 ? matches[0] : { matches };
};

/**
 * Drops doc citations first - they are the elastic part and identical on every match - then
 * trailing matches. One record always fits: its signature is capped at 300 characters upstream.
 */
const withinBudget = (opts: {
  records: ISymbolRecord[];
  docs: string[];
}): ISymbolMatch | ISymbolMatchesResponse => {
  const docs = [...opts.docs];
  let records = [...opts.records];
  let response = responseOf({ records, docs });
  const isOverBudget = (): boolean =>
    JSON.stringify(response).length > AtlasConstants.SEARCH_BUDGET_CHARS;

  while (isOverBudget() && docs.length > 0) {
    docs.pop();
    response = responseOf({ records, docs });
  }

  while (isOverBudget() && records.length > 1) {
    records = records.slice(0, -1);
    response = responseOf({ records, docs });
  }

  return response;
};

/**
 * The declaration goes on after the budget of the rest is met, once for each distinct declaration: a name
 * exported by two packages with the same shape (a re-export) names the first instead of repeating it.
 */
const withDeclarations = (opts: {
  response: ISymbolMatch | ISymbolMatchesResponse;
  records: ISymbolRecord[];
  symbols: ISymbolIndex;
}): ISymbolMatch | ISymbolMatchesResponse => {
  const matches = 'matches' in opts.response ? opts.response.matches : [opts.response];
  const firstOfShape = new Map<string, string>();
  const attached = matches.map((match, at) => {
    const record = opts.records[at];
    const first = record.shape === undefined ? undefined : firstOfShape.get(record.shape);

    if (first !== undefined) {
      return { ...match, declarationOf: first };
    }

    if (record.shape !== undefined) {
      firstOfShape.set(record.shape, record.specifier);
    }

    return { ...match, ...DeclarationReply.of({ record, symbols: opts.symbols }) };
  });

  return 'matches' in opts.response ? { matches: attached } : attached[0];
};

/** An answer, not an error: a store that holds symbols but not this name still knows what is close. */
const unknownSymbolOf = (opts: {
  name: string;
  symbols: ISymbolIndex;
}): IUnknownSymbolResponse => ({
  name: opts.name,
  matches: [],
  closest: opts.symbols.suggest({ name: opts.name, limit: SUGGESTIONS_MAX }),
});

export class SymbolTool {
  static build(opts: {
    store: IChunkIndex;
    symbols: ISymbolIndex;
    /** The projects the server serves, named in the description. */
    projects?: string;
  }): IToolHandler {
    return {
      definition: {
        name: 'symbol',
        description: `${ToolTriggers.symbol({ projects: opts.projects })} ${DESCRIPTION}`,
        inputSchema: INPUT_JSON_SCHEMA,
      },
      call: async ({ args }) => {
        const input = ToolInput.parse({ schema: SymbolInputSchema, args });

        if (opts.symbols.isEmpty()) {
          throw new RpcError({
            code: RpcErrorCodes.INVALID_PARAMS,
            message: opts.symbols.emptyReason,
          });
        }

        const records = opts.symbols.lookup({ name: input.name, package: input.package });

        if (records.length === 0) {
          return unknownSymbolOf({ name: input.name, symbols: opts.symbols });
        }

        const documented = opts.store.search({
          query: input.name,
          limit: DOCS_MAX,
          offset: 0,
        });

        const response = withinBudget({ records, docs: documented.hits.map((hit) => hit.id) });

        return withDeclarations({ response, records, symbols: opts.symbols });
      },
    };
  }
}
