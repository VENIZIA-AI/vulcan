/**
 * The last check of a page, on the markup that is about to be written: whatever the renderer did, the page makes no
 * request, has no inline style or handler, and holds exactly the style and the scripts its policy names. The renderer
 * escapes every text, so a spec cannot add markup; this gate says so about the output instead of trusting that.
 */
export class PageGate {
  /** Tags a page of this kind never has: each one loads something or sends something. */
  static readonly FORBIDDEN_TAGS = new Set([
    'link',
    'img',
    'iframe',
    'object',
    'embed',
    'base',
    'form',
    'frame',
    'frameset',
    'audio',
    'video',
    'source',
    'track',
    'picture',
    'input',
    'use',
    'image',
    'foreignobject',
  ]);

  /** Attributes that load or run something. */
  static readonly FORBIDDEN_ATTRIBUTES = new Set([
    'style',
    'src',
    'srcset',
    'formaction',
    'action',
    'ping',
    'poster',
    'background',
    'xlink:href',
  ]);

  /** Presentation attributes that take a `url(...)` and fetch it: they may name a place in the page and nothing else. */
  static readonly LOADING_ATTRIBUTES = new Set([
    'mask',
    'fill',
    'stroke',
    'filter',
    'clip-path',
    'marker-start',
    'marker-mid',
    'marker-end',
    'cursor',
    'content',
  ]);

  /** The executable scripts of a page: the head script that applies the saved theme, and the page script. */
  static readonly SCRIPTS = 2;

  static readonly CHECK =
    'output gate: no request, no inline style or handler, one style and two scripts, links to https only';

  /** What is wrong with `html`, one sentence each; empty when it is sound. */
  static problems(opts: { html: string }): string[] {
    const { html } = opts;
    const problems: string[] = [];
    const tags = html.matchAll(/<([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*\/?>/g);
    let scripts = 0;
    let styles = 0;

    for (const [, rawName = '', attributes = ''] of tags) {
      const name = rawName.toLowerCase();

      if (name === 'script') {
        scripts += /\stype="application\/json"/.test(attributes) ? 0 : 1;
      }

      if (name === 'style') {
        styles += 1;
      }

      if (PageGate.FORBIDDEN_TAGS.has(name)) {
        problems.push(`the page has a <${name}> tag`);
      }

      for (const [, attribute = '', value = ''] of attributes.matchAll(
        /\s+([^\s=>/]+)(?:="([^"]*)")?/g,
      )) {
        const key = attribute.toLowerCase();

        if (PageGate.FORBIDDEN_ATTRIBUTES.has(key) || key.startsWith('on')) {
          problems.push(`a <${name}> tag has the attribute ${key}`);
        }

        if (key === 'href' && name === 'a') {
          if (!value.startsWith('#') && !value.startsWith('https://')) {
            problems.push(
              `a link goes to '${value.slice(0, 40)}', not an https address or a place on the page`,
            );
          }

          continue;
        }

        if (key === 'href') {
          problems.push(`a <${name}> tag has an href`);
        }

        // A label, a title or a data attribute is text and may say anything; only an attribute that can fetch is held to it.
        if (
          PageGate.LOADING_ATTRIBUTES.has(key) &&
          (/url\((?!#)/i.test(value) || /(?:^|[\s(])(?:https?:)?\/\//i.test(value))
        ) {
          problems.push(`the ${key} of a <${name}> tag holds an address`);
        }
      }
    }

    if (scripts !== PageGate.SCRIPTS) {
      problems.push(`the page has ${scripts} scripts; its policy names ${PageGate.SCRIPTS}`);
    }

    if (styles !== 1) {
      problems.push(`the page has ${styles} style blocks; its policy names 1`);
    }

    for (const block of html.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
      const css = block[1] ?? '';

      if (/@import|@font-face|url\((?!#)/i.test(css)) {
        problems.push('the style loads something: @import, @font-face or url()');
      }
    }

    return [...new Set(problems)];
  }
}
