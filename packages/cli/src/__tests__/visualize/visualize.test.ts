import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { PAGE_CSS, PAGE_JS } from '../../visualize/assets.ts';
import {
  pageNameOf,
  renderSpecText,
  specSchemaText,
  VISUALIZE_SCHEMA,
  VisualizeLimits,
  writePage,
} from '../../visualize/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { fullSpec } from './spec.fixture.ts';

afterAll(removeProjects);

const render = (spec: Record<string, unknown>) => renderSpecText({ text: JSON.stringify(spec) });
const rendered = (spec: Record<string, unknown>): string => {
  const result = render(spec);

  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }

  return result.page.html;
};
const problems = (spec: Record<string, unknown>): string[] => {
  const result = render(spec);

  return result.ok ? [] : result.problems;
};
const withFlow = (change: (flow: Record<string, unknown[]>) => void): Record<string, unknown> => {
  const spec = fullSpec();
  const flow = spec['flow'] as Record<string, unknown[]>;

  change(flow);

  return spec;
};

describe('the spec', () => {
  test('a minimal spec renders: a title, a status and a verdict', () => {
    const html = rendered({
      schemaVersion: 1,
      title: 'T',
      status: { state: 'info' },
      verdict: 'V',
    });

    expect(html).toContain('<h1>T</h1>');
    expect(html).toContain('For information');
    expect(html).not.toContain('How it flows');
  });

  test('the full spec renders every section', () => {
    const html = rendered(fullSpec());

    for (const part of [
      'How it flows',
      'Before / After',
      'Decisions needed',
      'Evidence',
      'Risks',
      'Log',
      'Links',
      'Healthy?',
    ]) {
      expect(html).toContain(part);
    }

    expect(html).toContain('data-node="check"');
    expect(html).toContain('data-edge="check&gt;file"');
  });

  test.each([
    [{ surprise: 1 }, 'surprise'],
    [{ schemaVersion: 2 }, 'schemaVersion'],
    [{ status: { state: 'fine' } }, 'status.state'],
    [{ title: '' }, 'title'],
    [{ links: [{ label: 'x', href: 'http://example.com' }] }, 'links'],
    [{ links: [{ label: 'x', href: 'javascript:alert(1)' }] }, 'links'],
    [{ links: [{ label: 'x', href: 'data:text/html,hi' }] }, 'links'],
    [{ asOf: 'yesterday' }, 'asOf'],
    [{ decisions: [] }, 'decisions'],
    [{ evidence: [{ claim: 'c', probe: 'p', result: 'r', label: 'sure' }] }, 'evidence'],
  ])('%j is refused, naming %s', (change, where) => {
    const found = problems({ ...fullSpec(), ...change });

    expect(found.length).toBeGreaterThan(0);
    expect(found.join('\n')).toContain(where);
  });

  test('text that is not JSON is refused with the parse error', () => {
    const result = renderSpecText({ text: '{ nope' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems[0]).toContain('not valid JSON');
  });

  test('too many boxes, too many arrows, too many steps and too many decisions are refused', () => {
    const nodes = Array.from({ length: VisualizeLimits.MAX_NODES + 1 }, (_, index) => ({
      id: `n${index}`,
      label: 'x',
      row: Math.floor(index / 9),
      col: index % 9,
    }));

    expect(problems({ ...fullSpec(), flow: { nodes } }).join('\n')).toContain('flow.nodes');

    const edges = Array.from({ length: VisualizeLimits.MAX_EDGES + 1 }, () => ({
      from: 'n0',
      to: 'n1',
      label: 'x',
    }));

    expect(
      problems({ ...fullSpec(), flow: { nodes: nodes.slice(0, 3), edges } }).join('\n'),
    ).toContain('flow.edges');
    expect(
      problems({
        ...fullSpec(),
        decisions: Array.from({ length: 6 }, () => ({
          question: 'q',
          recommended: 'r',
          changes: 'c',
        })),
      }).join('\n'),
    ).toContain('decisions');
  });

  test('a repeated id, a shared cell, an edge to nowhere, a loop and a step on nothing are each named', () => {
    const duplicate = problems(
      withFlow((flow) => flow['nodes']?.push({ id: 'user', label: 'x', row: 3, col: 3 })),
    );
    const shared = problems(
      withFlow((flow) => flow['nodes']?.push({ id: 'extra', label: 'x', row: 0, col: 0 })),
    );
    const dangling = problems(
      withFlow((flow) => flow['edges']?.push({ from: 'user', to: 'nowhere', label: 'x' })),
    );
    const loop = problems(
      withFlow((flow) => flow['edges']?.push({ from: 'user', to: 'user', label: 'x' })),
    );
    const twice = problems(
      withFlow((flow) => flow['edges']?.push({ from: 'user', to: 'form', label: 'again' })),
    );
    const step = problems(
      withFlow((flow) =>
        flow['steps']?.push({ title: 's', note: 'n', nodes: ['ghost'], edges: ['user>ghost'] }),
      ),
    );

    expect(duplicate.join('\n')).toContain("id 'user' is used twice");
    expect(shared.join('\n')).toContain('both in row 0, col 0');
    expect(dangling.join('\n')).toContain("'nowhere', which is not a node");
    expect(loop.join('\n')).toContain('loops to itself');
    expect(twice.join('\n')).toContain('is drawn twice');
    expect(step.join('\n')).toContain("node 'ghost' does not exist");
    expect(step.join('\n')).toContain("edge 'user>ghost' does not exist");
  });

  test('an arrow through a box, a corner on a box, two arrows on one line and a long arrow label are refused', () => {
    const grid = (nodes: Record<string, unknown>[], edges: Record<string, unknown>[]) => ({
      ...fullSpec(),
      flow: { nodes, edges, steps: [] },
    });
    const box = (id: string, row: number, col: number) => ({ id, label: id, row, col });
    const through = problems(
      grid([box('a', 0, 0), box('b', 0, 1), box('d', 0, 2)], [{ from: 'a', to: 'd', label: 'x' }]),
    );
    const corner = problems(
      grid([box('a', 0, 0), box('b', 0, 1), box('c', 1, 1)], [{ from: 'a', to: 'c', label: 'x' }]),
    );
    const both = problems(
      grid(
        [box('a', 0, 0), box('b', 0, 1)],
        [
          { from: 'a', to: 'b', label: 'x' },
          { from: 'b', to: 'a', label: 'y' },
        ],
      ),
    );
    const clear = problems(
      grid([box('a', 0, 0), box('c', 1, 1)], [{ from: 'a', to: 'c', label: 'goes down' }]),
    );
    const long = problems(
      grid([box('a', 0, 0), box('b', 0, 1)], [{ from: 'a', to: 'b', label: 'x'.repeat(21) }]),
    );

    expect(through.join('\n')).toContain("through box 'b'");
    expect(corner.join('\n')).toContain("through box 'b'");
    expect(both.join('\n')).toContain('run on the same line');
    expect(clear).toEqual([]);
    expect(long.join('\n')).toContain('flow.edges.0.label');
  });

  test('blank text, a line break and a bidi control are refused', () => {
    for (const title of ['   ', 'a\nb', 'a\u202Eb']) {
      expect(problems({ ...fullSpec(), title }).join('\n')).toContain('title');
    }
  });

  test('the printed schema accepts the worked spec and names the closed sets and https', () => {
    const schema = JSON.parse(specSchemaText());
    const required: string[] = schema.properties.flow.required;

    expect(schema.required).not.toContain('language');
    expect(required).not.toContain('edges');
    expect(schema.properties.status.properties.state.pattern).toContain('blocked');
    expect(schema.properties.links.items.properties.href.pattern).toContain('https');
    expect(new RegExp(schema.properties.language.pattern).test('pt-BR')).toBe(true);
  });

  test('the JSON Schema can be printed and names the title', () => {
    const schema = JSON.parse(specSchemaText());

    expect(schema.properties.title.type).toBe('string');
    expect(schema.additionalProperties).toBe(false);
    expect(VISUALIZE_SCHEMA.safeParse(fullSpec()).success).toBe(true);
  });
});

describe('the page is safe by construction', () => {
  test('everything the spec says is escaped, never markup', () => {
    const hostile = '<img src=x onerror=alert(2)> & "q" \'s\'';
    const html = rendered({
      ...fullSpec(),
      title: hostile,
      verdict: hostile,
      flow: {
        nodes: [{ id: 'a', label: hostile, sublabel: hostile, detail: hostile, row: 0, col: 0 }],
        edges: [],
        steps: [{ title: hostile, note: hostile, nodes: ['a'], edges: [] }],
      },
    });

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
    expect(html).toContain('&quot;q&quot;');
    // The steps ride in a JSON block that cannot close its own tag.
    const block =
      /<script type="application\/json" id="steps">(.*?)<\/script>/s.exec(html)?.[1] ?? '';

    expect(block).not.toContain('<');
    expect(JSON.parse(block)[0].title).toBe(hostile);
  });

  test('the policy allows only the page own style and script, by hash, and nothing else', () => {
    const html = rendered(fullSpec());
    const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
    const hash = (text: string): string =>
      `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

    expect(policy).toContain('default-src &#39;none&#39;');
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';

    // The style is the page's own sheet and the rules this page needs; the policy holds the hash of exactly that text.
    expect(style.startsWith(PAGE_CSS)).toBe(true);
    expect(policy).toContain(hash(style).replaceAll("'", '&#39;'));
    expect(policy).toContain(hash(PAGE_JS).replaceAll("'", '&#39;'));
    expect(html).toContain(`<script>${PAGE_JS}</script>`);
    expect(policy).not.toContain('unsafe');
  });

  test("no request at view time: no link tag, image, import, font, url() or absolute address except the reader's links", () => {
    const html = rendered(fullSpec());
    const withoutLinks = html
      .replace(/<a href="[^"]*"[^>]*>/g, '')
      .replaceAll('marker-end="url(#a)"', '');

    for (const bad of [
      '<link',
      '<img',
      '<iframe',
      '<object',
      '@import',
      'url(',
      '@font-face',
      'fetch(',
      'XMLHttpRequest',
      'http://',
      'https://',
    ]) {
      expect(withoutLinks, bad).not.toContain(bad);
    }

    expect(html).toContain('rel="noopener noreferrer"');
  });

  test('the page script sets text with textContent only', () => {
    expect(PAGE_JS).not.toContain('innerHTML');
    expect(PAGE_JS).not.toContain('eval(');
    expect(PAGE_JS).not.toContain('document.write');
  });

  test('the final state needs no script and no motion: print and reduced motion are handled', () => {
    expect(PAGE_CSS).toContain('prefers-reduced-motion:reduce');
    expect(PAGE_CSS).toContain('@media print');
    expect(PAGE_CSS).toContain('prefers-color-scheme:dark');
    expect(rendered(fullSpec())).toContain('<ol class="steps-note">');
  });
});

describe('a step note cannot close the page script block', () => {
  test('</script> and an HTML comment in a note stay inside the JSON', () => {
    const note = '</script><!-- <script>alert(1)</script>';
    const html = rendered({
      ...fullSpec(),
      flow: {
        nodes: [{ id: 'a', label: 'a', row: 0, col: 0 }],
        edges: [],
        steps: [{ title: 't', note, nodes: ['a'], edges: [] }],
      },
    });
    const block =
      /<script type="application\/json" id="steps">(.*?)<\/script>/s.exec(html)?.[1] ?? '';

    expect(JSON.parse(block)[0].note).toBe(note);
    expect(html.match(/<script/g)?.length).toBe(2);
  });
});

describe('an error arrow', () => {
  test('has its own red arrowhead: a marker does not inherit the arrow colour', () => {
    const html = rendered(
      withFlow((flow) =>
        flow['edges']?.push({ from: 'digest', to: 'user', label: 'fails', variant: 'error' }),
      ),
    );

    expect(html).toContain('marker-end="url(#e)"');
    expect(html).toContain('<marker id="e"');
    expect(PAGE_CSS).toContain('marker .bad{fill:var(--bad)}');
  });
});

describe('the page words', () => {
  test('are English, and a spec replaces any of them - the owner own language is a setting', () => {
    const html = rendered({
      ...fullSpec(),
      language: 'fr',
      chrome: {
        flow: 'Comment ca circule',
        statusStates: { ok: 'En bonne voie' },
        evidenceLabels: { verified: 'verifie' },
      },
    });

    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('Comment ca circule');
    expect(html).toContain('En bonne voie');
    expect(html).toContain('verifie');
    expect(html).toContain('Decisions needed');
    expect(html).toContain('Evidence');
  });

  test('an unknown word key or a non-string is refused', () => {
    expect(problems({ ...fullSpec(), chrome: { nonsense: 'x' } }).length).toBeGreaterThan(0);
    expect(problems({ ...fullSpec(), chrome: { flow: 3 } }).length).toBeGreaterThan(0);
  });
});

describe('the page reads the answer first', () => {
  test('the banner, the tiles and the minimap, then your action, then the figure, the decisions and the evidence', () => {
    const html = rendered(fullSpec());
    const at = (part: string): number => html.indexOf(part);

    expect(at('data-hero')).toBeLessThan(at('class="tiles"'));
    expect(at('class="tiles"')).toBeLessThan(at('id="minimap"'));
    expect(at('id="minimap"')).toBeLessThan(at('class="two"'));
    expect(at('class="two"')).toBeLessThan(at('id="flow"'));
    expect(at('id="flow"')).toBeLessThan(at('id="decisions"'));
    expect(at('id="decisions"')).toBeLessThan(at('id="evidence"'));
    expect(html).toContain('What you need to do');
    expect(html).toContain('<a class="jump" href="#decisions">Decisions needed (');
  });

  test('the banner carries the state as an icon, a colour and a word', () => {
    const html = rendered(fullSpec());

    expect(html).toMatch(/<header class="banner c-ok"/);
    expect(html).toContain('class="word">On track<');
    expect(rendered({ ...fullSpec(), status: { state: 'blocked' } })).toMatch(
      /<header class="banner c-bad"/,
    );
    expect(
      rendered({ ...fullSpec(), status: { state: 'warn', label: 'Waiting for you' } }),
    ).toContain('class="word">Waiting for you<');
  });

  test('the minimap gives every task a shape and a word, the tiles count the states, and a spec replaces the words', () => {
    const html = rendered(fullSpec());

    expect(html).toContain('class="seg c-ok"');
    expect(html).toContain('class="seg c-info"');
    expect(html).toContain('class="seg c-mut"');
    expect(html).toContain('<span>in progress</span>');
    expect(html).toMatch(/class="tile c-ok"[^>]*>.*?<span class="n">1 \/ 3<\/span>/);

    const french = rendered({
      ...fullSpec(),
      chrome: { minimap: 'Ou en sont les choses', minimapStates: { done: 'fait' } },
    });

    expect(french).toContain('Ou en sont les choses');
    expect(french).toContain('<span>fait</span>');
  });

  test('a status the minimap does not know, an empty minimap and a long task are refused', () => {
    const row = { task: 'T', status: 'done' };

    expect(problems({ ...fullSpec(), minimap: [{ ...row, status: 'almost' }] }).join()).toContain(
      'minimap',
    );
    expect(problems({ ...fullSpec(), minimap: [] }).join()).toContain('minimap');
    expect(
      problems({ ...fullSpec(), minimap: [{ ...row, task: 'x'.repeat(61) }] }).join(),
    ).toContain('minimap');
    expect(problems({ ...fullSpec(), minimap: [{ ...row, extra: 1 }] }).join()).toContain(
      'minimap',
    );
  });

  test('evidence tags differ in shape as well as in word, and tables name each cell for a phone', () => {
    const html = rendered({
      ...fullSpec(),
      risks: [{ risk: 'R', impact: 'I', fallback: 'F' }],
    });

    expect(html).toMatch(/class="badge ev-verified">/);
    expect(html).toContain('.ev-inferred{--c:var(--warn)');
    expect(html).toContain('<table class="stack">');
    expect(html).toContain('data-label="Risk"');
    expect(html).toContain('.stack td[data-label]::before{content:attr(data-label)');
  });

  test('a flow is also a list for a phone, and the figure gives way to it before its text drops under 12 px', () => {
    const html = rendered(fullSpec());

    expect(html).toContain('<ol class="path">');
    expect(html).toContain('<span class="verb main">');
    // 3 columns are 3 x 290 + 48 = 918 px; 92% of that, plus the page padding, is the width below which the list shows.
    expect(html).toMatch(/class="fig f918"/);
    expect(html).toContain(
      `@media (max-width:${Math.ceil(918 * 0.92) + 66}px){.fig.f918{display:none}`,
    );
    expect(html).toContain('.fig.f918~.path');
  });

  test('there is no inline style anywhere: the page policy would block it', () => {
    expect(rendered(fullSpec())).not.toMatch(/ style=/);
  });

  test('print shows the figure and not the phone list', () => {
    expect(PAGE_CSS).toContain(
      '.fig{overflow:visible;display:block!important}.path,.path-detail{display:none!important}',
    );
    expect(PAGE_CSS).toContain('[data-slide]{display:block!important');
  });
});

describe('the size', () => {
  test('a page that uses every section stays far under the cap, and says its size', () => {
    const result = render(fullSpec());

    expect(result.ok && result.page.bytes).toBeLessThan(40 * 1024);
    expect(result.ok && result.page.checks.some((check) => check.startsWith('size '))).toBe(true);
    expect(result.ok && result.page.warnings).toEqual([]);
  });

  test('a page past the cap is refused: two pages, not one dense page', () => {
    const long = 'x'.repeat(VisualizeLimits.MAX_SENTENCE);
    const rows = <T>(row: T): T[] =>
      Array.from({ length: VisualizeLimits.MAX_ROWS_PER_TABLE }, () => row);
    const result = render({
      ...fullSpec(),
      evidence: rows({ claim: long, probe: long, result: long, label: 'verified' }),
      risks: rows({ risk: long, impact: long, fallback: long }),
      log: rows({ date: '2026-10-25', text: long }),
      beforeAfter: {
        before: { title: 'b', items: rows({ text: long }) },
        after: { title: 'a', items: rows({ text: long }) },
      },
      flow: {
        nodes: Array.from({ length: 25 }, (_, index) => ({
          id: `n${index}`,
          label: 'x',
          detail: 'd'.repeat(VisualizeLimits.MAX_DETAIL),
          row: Math.floor(index / 5),
          col: index % 5,
        })),
        edges: [],
        steps: [],
      },
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems[0]).toContain('two pages, not one dense page');
  });
});

describe('writePage', () => {
  const project = (): string => {
    const root = createProject({ files: { '.gitignore': '.agents/local/\n' } });

    mkdirSync(join(root, '.agents/local'), { recursive: true });

    return root;
  };

  test('writes inside .agents/local/prototypes/ and leaves no partial file', () => {
    const root = project();
    const result = writePage({ root, name: 'status', html: '<p>a</p>' });

    expect(result.ok && result.path).toBe(join(root, '.agents/local/prototypes/status.html'));
    expect(readFileSync(join(root, '.agents/local/prototypes/status.html'), 'utf8')).toBe(
      '<p>a</p>',
    );
    expect(readdirSync(join(root, '.agents/local/prototypes'))).toEqual(['status.html']);
  });

  test('a second write replaces the first whole', () => {
    const root = project();

    writePage({ root, name: 'status', html: 'one' });
    writePage({ root, name: 'status', html: 'two' });

    expect(readFileSync(join(root, '.agents/local/prototypes/status.html'), 'utf8')).toBe('two');
  });

  test('without .agents/local/, or through a symlink, it refuses and writes nothing outside', () => {
    const none = createProject({ files: {} });
    const outside = createProject({ files: {} });
    const linked = createProject({ files: {} });
    const prototypes = createProject({ files: {} });

    mkdirSync(join(linked, '.agents'), { recursive: true });
    symlinkSync(outside, join(linked, '.agents/local'));
    mkdirSync(join(prototypes, '.agents/local'), { recursive: true });
    symlinkSync(outside, join(prototypes, '.agents/local/prototypes'));

    for (const root of [none, linked, prototypes]) {
      expect(writePage({ root, name: 'x', html: 'x' }).ok).toBe(false);
    }

    expect(readdirSync(outside)).toEqual([]);
  });

  test('a planted .partial symlink is never followed, and a dangling prototypes link is a refusal', () => {
    const root = project();
    const outside = createProject({ files: { 'victim.txt': 'keep' } });
    const dangling = project();

    mkdirSync(join(root, '.agents/local/prototypes'), { recursive: true });
    symlinkSync(
      join(outside, 'victim.txt'),
      join(root, '.agents/local/prototypes/x.html.1.partial'),
    );
    expect(writePage({ root, name: 'x', html: 'new' }).ok).toBe(true);
    expect(readFileSync(join(outside, 'victim.txt'), 'utf8')).toBe('keep');

    symlinkSync(join(outside, 'missing'), join(dangling, '.agents/local/prototypes'));
    expect(writePage({ root: dangling, name: 'x', html: 'new' }).ok).toBe(false);
  });

  test('page names become safe file names', () => {
    expect(pageNameOf({ name: 'My Status.json' })).toBe('my-status');
    expect(pageNameOf({ name: '../../etc/passwd' })).toBe('passwd');
    expect(pageNameOf({ name: '...' })).toBeUndefined();
    expect(pageNameOf({ name: 'a'.repeat(200) })?.length).toBe(64);
    expect(pageNameOf({ name: `${'a'.repeat(63)}-b` })).toBe('a'.repeat(63));
  });
});

describe('vulcan visualize', () => {
  const setup = (): { root: string; spec: string } => {
    const root = createProject({
      files: { '.gitignore': '.agents/local/\n', 'package.json': '{}' },
    });

    mkdirSync(join(root, '.agents/local'), { recursive: true });
    writeFileSync(join(root, 'status.json'), JSON.stringify(fullSpec()));

    return { root, spec: 'status.json' };
  };

  test('writes the page, prints its path, and says which checks ran and which did not', () => {
    const { root, spec } = setup();
    const result = runCli({ args: ['visualize', spec], cwd: root });

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(join(root, '.agents/local/prototypes/status.html'));
    expect(result.stderr).toContain('checks that ran:');
    expect(result.stderr).toContain('not run here: a browser check at 390 and 1280 px');
    expect(existsSync(join(root, '.agents/local/prototypes/status.html'))).toBe(true);
  });

  test('--out names the page; a bad spec writes nothing and lists every problem; the last good page stays', () => {
    const { root, spec } = setup();

    expect(runCli({ args: ['visualize', spec, '--out', 'Round Status'], cwd: root }).code).toBe(0);
    expect(existsSync(join(root, '.agents/local/prototypes/round-status.html'))).toBe(true);

    writeFileSync(
      join(root, 'bad.json'),
      JSON.stringify({ ...fullSpec(), title: '', verdict: '', surprise: 1 }),
    );

    const before = readFileSync(join(root, '.agents/local/prototypes/round-status.html'), 'utf8');
    const result = runCli({ args: ['visualize', 'bad.json', '--out', 'round-status'], cwd: root });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('nothing was written');
    expect(result.stderr).toContain('title');
    expect(result.stderr).toContain('verdict');
    expect(readFileSync(join(root, '.agents/local/prototypes/round-status.html'), 'utf8')).toBe(
      before,
    );
  });

  test('a directory, a missing --out value, a repeated --out and an unnamable file are refused in one line', () => {
    const { root, spec } = setup();

    mkdirSync(join(root, 'folder.json'));
    writeFileSync(join(root, '.json'), JSON.stringify(fullSpec()));

    for (const args of [
      ['visualize', 'folder.json'],
      ['visualize', spec, '--out'],
      ['visualize', spec, '--out', '--schema'],
      ['visualize', spec, '--out', 'a', '--out', 'b'],
      ['visualize', '.json'],
    ]) {
      const result = runCli({ args, cwd: root });

      expect(result.code, args.join(' ')).toBe(1);
      expect(result.stderr).not.toContain('at ');
      expect(result.stderr).not.toContain('undefined');
    }

    expect(readdirSync(join(root, '.agents/local'))).not.toContain('prototypes');
  });

  test('--schema prints the JSON Schema and needs no project', () => {
    const result = runCli({ args: ['visualize', '--schema'], cwd: createProject({ files: {} }) });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).properties.verdict.type).toBe('string');
  });

  test('a missing file, a missing argument and a missing .agents/local/ are each a clear refusal', () => {
    const { root } = setup();
    const bare = createProject({ files: { 'a.json': JSON.stringify(fullSpec()) } });

    expect(runCli({ args: ['visualize', 'missing.json'], cwd: root }).stderr).toContain(
      'is not a file',
    );
    expect(runCli({ args: ['visualize'], cwd: root }).code).toBe(1);
    expect(runCli({ args: ['visualize', 'a.json'], cwd: bare }).stderr).toContain(
      'run vulcan sync first',
    );
    expect(runCli({ args: ['visualize', 'a.json', '--bogus'], cwd: root }).code).not.toBe(0);
  });
});
