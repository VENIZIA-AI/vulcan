import { AtlasConstants } from '@/common';
import { RpcError, RpcErrorCodes } from '@/protocol/common';
import type { IToolHandler } from '@/protocol/common';
import type { IChunkIndex } from '@/search/common';
import type { ISymbolIndex, ISymbolRecord } from '@/symbols';
import { z } from 'zod';
import { parseInput, SymbolInputSchema, ToolTriggers } from './common';

const DESCRIPTION =
  'Locate one exported symbol by name: which package and import specifier it comes from, its ' +
  'kind, its one-line signature, the source `file` and `line` it is declared on, and the chunk ' +
  'ids that document it. An unknown name is not an error: it answers `matches: []` and up to ' +
  'five `closest` known names.';

// Built once at module load - a guarded tool that re-resolves its store on every call never needs
// to rebuild this.
const INPUT_JSON_SCHEMA = z.toJSONSchema(SymbolInputSchema);

const DOCS_MAX = 5;
const SUGGESTIONS_MAX = 5;

/** One record plus the chunk ids that document it; `docs` is the same list for every match of one name. */
interface ISymbolMatch extends ISymbolRecord {
  docs: string[];
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
  // `shape` is for the concept lock, not for a client.
  return { ...opts.record, shape: undefined, docs: opts.docs };
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

/** An answer, not an error: a store that holds symbols but not this name still knows what is close. */
const unknownSymbolOf = (opts: {
  name: string;
  symbols: ISymbolIndex;
}): IUnknownSymbolResponse => ({
  name: opts.name,
  matches: [],
  closest: opts.symbols.suggest({ name: opts.name, limit: SUGGESTIONS_MAX }),
});

export const buildSymbolTool = (opts: {
  store: IChunkIndex;
  symbols: ISymbolIndex;
  /** The projects the server serves, named in the description. */
  projects?: string;
}): IToolHandler => ({
  definition: {
    name: 'symbol',
    description: `${ToolTriggers.symbol({ projects: opts.projects })} ${DESCRIPTION}`,
    inputSchema: INPUT_JSON_SCHEMA,
  },
  call: async ({ args }) => {
    const input = parseInput({ schema: SymbolInputSchema, args });

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

    return withinBudget({ records, docs: documented.hits.map((hit) => hit.id) });
  },
});
