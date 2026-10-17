import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { BUNDLE, REPO, SECTION_LABELS, SECTION_ORDER, VIZ_BRAND, VIZ_COPY } from '../config.ts';
import type { Concept } from '../lib.ts';
import { loadConceptsOrExit } from '../lib.ts';
import { escapeHtml } from './client/html.ts';
import { VizConstants, VizTemplateTokens } from './common/index.ts';
import type { IVizData, IVizEdge, IVizNode, IVizSection } from './common/index.ts';

const TEMPLATE_FILE = join(import.meta.dir, 'template.html');
const CLIENT_ENTRY = join(import.meta.dir, 'client', 'main.ts');
const KNOWN_SECTIONS = new Set<string>(SECTION_ORDER);

const toSectionTitle = (opts: { key: string }): string =>
  SECTION_LABELS[opts.key] ??
  opts.key.replace(
    /(^|-)([a-z])/g,
    (_, separator: string, letter: string) => `${separator ? ' ' : ''}${letter.toUpperCase()}`,
  );

const extractSection = (opts: { id: string }): string => opts.id.split('/')[1] || 'overview';

/** A `</script` inside an inline script ends the element early; `<\/` means the same to JS and JSON. */
const escapeScriptClose = (opts: { text: string }): string =>
  opts.text.replace(/<\/(script)/gi, '<\\/$1');

export const buildVizData = (opts: { concepts: Concept[] }): IVizData => {
  const concepts = opts.concepts.filter(concept => !concept.reserved);
  const ids = new Set(concepts.map(concept => concept.id));

  const nodes: IVizNode[] = concepts.map(concept => ({
    id: concept.id,
    type: concept.type,
    title: concept.title,
    description: concept.description,
    resource: concept.resource,
    tags: concept.tags,
    body: concept.body,
    group: extractSection({ id: concept.id }),
    degree: 0,
  }));
  const nodeById = new Map(nodes.map(node => [node.id, node]));

  const edges: IVizEdge[] = [];
  const seen = new Set<string>();

  for (const concept of concepts) {
    for (const target of concept.links) {
      const key = `${concept.id} ${target}`;

      if (target === concept.id || !ids.has(target) || seen.has(key)) {
        continue;
      }

      seen.add(key);
      edges.push({ source: concept.id, target });

      for (const end of [concept.id, target]) {
        const node = nodeById.get(end);

        if (node) {
          node.degree++;
        }
      }
    }
  }

  const present = new Set(nodes.map(node => node.group));
  const ordered = [
    ...SECTION_ORDER.filter(section => present.has(section)),
    ...[...present].filter(section => !KNOWN_SECTIONS.has(section)).sort(),
  ];
  const sections: IVizSection[] = ordered.map(key => ({
    key,
    label: toSectionTitle({ key }),
    count: nodes.filter(node => node.group === key).length,
  }));

  return { brand: VIZ_BRAND, nodes, edges, sections, copy: VIZ_COPY };
};

/** Function replacers, so a `$&` or `$'` in the data is inserted literally. */
export const assembleVizHtml = (opts: {
  template: string;
  data: IVizData;
  clientScript: string;
}): string =>
  opts.template
    .replaceAll(VizTemplateTokens.BRAND, () => escapeHtml({ text: opts.data.brand }))
    .replaceAll(VizTemplateTokens.DATA, () =>
      escapeScriptClose({ text: JSON.stringify(opts.data) }),
    )
    .replaceAll(VizTemplateTokens.CLIENT, () => escapeScriptClose({ text: opts.clientScript }));

export const bundleVizClient = async (): Promise<string> => {
  const result = await Bun.build({
    entrypoints: [CLIENT_ENTRY],
    target: 'browser',
    format: 'iife',
    minify: true,
  });
  const [output] = result.outputs;

  if (!result.success || output === undefined) {
    const reasons = result.logs.map(log => String(log)).join('\n');

    console.error(`[bundleVizClient] failed to bundle ${relative(REPO, CLIENT_ENTRY)}\n${reasons}`);
    process.exit(1);
  }

  return output.text();
};

export const buildViz = async (): Promise<void> => {
  const data = buildVizData({ concepts: loadConceptsOrExit() });
  const html = assembleVizHtml({
    template: readFileSync(TEMPLATE_FILE, 'utf8'),
    data,
    clientScript: await bundleVizClient(),
  });

  const out = join(BUNDLE, VizConstants.OUTPUT_FILE);

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);

  console.log(`viz: wrote ${relative(REPO, out)}`);
  console.log(
    `viz: ${data.nodes.length} nodes, ${data.edges.length} edges, ${data.sections.length} sections`,
  );
};
