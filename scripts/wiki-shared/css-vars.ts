/**
 * The final value of every custom property a built wiki declares on `:root` and `.dark`, in cascade order
 * (the last declaration wins), read from the stylesheets and inline styles of its `index.html`. Build the wiki
 * before and after a change, run this on both folders and diff the two outputs: an empty diff is a change that
 * moved no colour.
 *
 *   bun scripts/wiki-shared/css-vars.ts docs/wiki/site/.vitepress/dist > after.json
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type TVariables = Record<string, string>;

const SHEET =
  /<link[^>]*rel="[^"]*stylesheet[^"]*"[^>]*href="([^"]+)"|<style[^>]*>([\s\S]*?)<\/style>/g;
const DECLARATION = /(--[\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g;
const DARK_SELECTORS = new Set(['.dark', 'html.dark', ':root.dark']);

export class CssVars {
  /** The `:root` and `.dark` variables of the built wiki in `opts.dist`, sorted by name. */
  static read(opts: { dist: string }): { ':root': TVariables; '.dark': TVariables } {
    const html = readFileSync(join(opts.dist, 'index.html'), 'utf8');
    const seen = new Set<string>();
    const found = { ':root': {} as TVariables, '.dark': {} as TVariables };

    for (const match of html.matchAll(SHEET)) {
      const href = match[1];

      if (href !== undefined && seen.has(href)) {
        continue;
      }

      seen.add(href ?? '');
      CssVars.collect({
        css:
          href === undefined
            ? (match[2] ?? '')
            : readFileSync(join(opts.dist, href.replace(/^\//, '')), 'utf8'),
        found,
      });
    }

    return {
      ':root': CssVars.sorted({ variables: found[':root'] }),
      '.dark': CssVars.sorted({ variables: found['.dark'] }),
    };
  }

  private static sorted(opts: { variables: TVariables }): TVariables {
    return Object.fromEntries(
      Object.entries(opts.variables).sort(([first], [second]) => first.localeCompare(second)),
    );
  }

  private static collect(opts: {
    css: string;
    found: { ':root': TVariables; '.dark': TVariables };
  }): void {
    const css = opts.css.replace(/\/\*[\s\S]*?\*\//g, '');
    let index = 0;

    while (index < css.length) {
      const open = css.indexOf('{', index);

      if (open === -1) {
        return;
      }

      const prelude = css.slice(index, open).trim();
      let depth = 1;
      let cursor = open + 1;

      while (depth > 0 && cursor < css.length) {
        depth += css[cursor] === '{' ? 1 : css[cursor] === '}' ? -1 : 0;
        cursor += 1;
      }

      const body = css.slice(open + 1, cursor - 1);

      if (prelude.startsWith('@')) {
        if (/^@(media|supports|layer)/.test(prelude)) {
          CssVars.collect({ css: body, found: opts.found });
        }
      } else {
        for (const selector of prelude.split(',').map((item) => item.trim())) {
          const target =
            selector === ':root' ? ':root' : DARK_SELECTORS.has(selector) ? '.dark' : undefined;

          if (target !== undefined) {
            for (const match of body.matchAll(DECLARATION)) {
              opts.found[target][match[1] ?? ''] = (match[2] ?? '').replace(/\s+/g, ' ');
            }
          }
        }
      }

      index = cursor;
    }
  }
}

if (import.meta.main) {
  const dist = process.argv[2];

  if (dist === undefined) {
    console.error('usage: bun scripts/wiki-shared/css-vars.ts <built wiki folder>');
    process.exit(2);
  }

  console.log(JSON.stringify(CssVars.read({ dist }), null, 1));
}
