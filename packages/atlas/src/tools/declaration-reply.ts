import type { ISymbolIndex, ISymbolRecord } from '@/symbols';
import { DeclarationText } from '@/symbols/declaration-text';

/** The declaration text of one match of `symbol`, with the exported symbols it uses. */
export interface IDeclarationReply {
  declaration: string;
  /** True when something was left out to stay within the budget: a declaration cut, or a used symbol skipped. */
  truncated?: boolean;
}

/**
 * What `symbol` adds beside the signature: the declaration as the package ships it - its TSDoc and its
 * members - then, nearest first, the declarations of the exported symbols it uses, until the budget is spent.
 * A reader following an options type to the alias it names to the class behind that alias needs no second call.
 */
export class DeclarationReply {
  static readonly BUDGET_CHARS = 10_000;
  /** How far from the asked symbol a used symbol is followed. */
  static readonly MAX_DEPTH = 3;

  static of(opts: { record: ISymbolRecord; symbols: ISymbolIndex }): IDeclarationReply | undefined {
    const { record, symbols } = opts;

    if (record.declaration === undefined || record.declaration === '') {
      return undefined;
    }

    const own = DeclarationText.cut({
      text: record.declaration,
      max: DeclarationReply.BUDGET_CHARS,
    });
    const blocks = [own];
    // A paragraph already shown (an internal type two exports share) is not repeated.
    const shown = new Set<string>(own.split('\n\n'));
    let spent = own.length;
    let isTruncated = own !== record.declaration;
    const seen = new Set<string>([record.name]);
    let level = record.uses ?? [];

    for (let depth = 1; depth <= DeclarationReply.MAX_DEPTH && level.length > 0; depth += 1) {
      const next: string[] = [];
      // Small declarations first: a huge class used in passing must not use the budget the small types need.
      const neighbours = level
        .filter((name) => !seen.has(name))
        .map((name) => DeclarationReply.neighbourOf({ name, record, symbols }))
        .filter((item): item is ISymbolRecord => item !== undefined)
        .sort((left, right) => (left.declaration?.length ?? 0) - (right.declaration?.length ?? 0));

      for (const neighbour of neighbours) {
        if (seen.has(neighbour.name) || neighbour.declaration === undefined) {
          continue;
        }

        seen.add(neighbour.name);

        const paragraphs = neighbour.declaration.split('\n\n').filter((item) => !shown.has(item));
        // Everything of it was shown with an earlier block: a header with no body would say nothing.
        if (paragraphs.length === 0) {
          continue;
        }

        const block = `// ${neighbour.name} (${neighbour.specifier})\n${paragraphs.join('\n\n')}`;

        if (spent + block.length + 2 > DeclarationReply.BUDGET_CHARS) {
          isTruncated = true;
          continue;
        }

        blocks.push(block);
        spent += block.length + 2;

        for (const item of neighbour.declaration.split('\n\n')) {
          shown.add(item);
        }

        next.push(...(neighbour.uses ?? []));
      }

      level = next;
    }

    return {
      declaration: blocks.join('\n\n'),
      ...(isTruncated ? { truncated: true } : {}),
    };
  }

  /** The record a used name stands for: the one of the same package when the name is exported by several. */
  private static neighbourOf(opts: {
    name: string;
    record: ISymbolRecord;
    symbols: ISymbolIndex;
  }): ISymbolRecord | undefined {
    const found = opts.symbols.lookup({ name: opts.name });

    return (
      found.find((item) => item.package === opts.record.package && item.declaration) ??
      found.find((item) => item.declaration)
    );
  }
}
