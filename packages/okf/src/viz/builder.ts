import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { OkfProject } from '../project/index.ts';
import type { Concept } from '../lib.ts';
import { ConceptLoader } from '../lib.ts';
import { HtmlText } from './client/html.ts';
import { VizTemplateTokens } from './common/index.ts';
import { VizCopy } from './copy.ts';
import type { IVizData, IVizEdge, IVizNode, IVizSection } from './common/index.ts';

const TEMPLATE_FILE = join(import.meta.dir, 'template.html');
const CLIENT_ENTRY = join(import.meta.dir, 'client', 'main.ts');
const toSectionTitle = (opts: { key: string; labels: Record<string, string> }): string =>
  opts.labels[opts.key] ??
  opts.key.replace(
    /(^|-)([a-z])/g,
    (_, separator: string, letter: string) => `${separator ? ' ' : ''}${letter.toUpperCase()}`,
  );

const extractSection = (opts: { id: string }): string => opts.id.split('/')[1] || 'overview';

/** A `</script` inside an inline script ends the element early; `<\/` means the same to JS and JSON. */
const escapeScriptClose = (opts: { text: string }): string =>
  opts.text.replace(/<\/(script)/gi, '<\\/$1');

export class VizBuilder {
  static buildData(opts: { concepts: Concept[] }): IVizData {
    const concepts = opts.concepts.filter((concept) => !concept.reserved);
    const ids = new Set(concepts.map((concept) => concept.id));

    const nodes: IVizNode[] = concepts.map((concept) => ({
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
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

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

    const project = OkfProject.read();
    const known = new Set(project.sections.order);
    const present = new Set(nodes.map((node) => node.group));
    const ordered = [
      ...project.sections.order.filter((section) => present.has(section)),
      ...[...present].filter((section) => !known.has(section)).sort(),
    ];
    const sections: IVizSection[] = ordered.map((key) => ({
      key,
      label: toSectionTitle({ key, labels: project.sections.labels }),
      count: nodes.filter((node) => node.group === key).length,
    }));

    return {
      brand: project.viz.brand,
      nodes,
      edges,
      sections,
      copy: VizCopy.resolve({ brand: project.viz.brand, copy: project.viz.copy }),
    };
  }

  /** Function replacers, so a `$&` or `$'` in the data is inserted literally. */
  static assembleHtml(opts: { template: string; data: IVizData; clientScript: string }): string {
    return opts.template
      .replaceAll(VizTemplateTokens.BRAND, () => HtmlText.escape({ text: opts.data.brand }))
      .replaceAll(VizTemplateTokens.DATA, () =>
        escapeScriptClose({ text: JSON.stringify(opts.data) }),
      )
      .replaceAll(VizTemplateTokens.CLIENT, () => escapeScriptClose({ text: opts.clientScript }));
  }

  static async bundleClient(): Promise<string> {
    const result = await Bun.build({
      entrypoints: [CLIENT_ENTRY],
      target: 'browser',
      format: 'iife',
      minify: true,
    });
    const [output] = result.outputs;

    if (!result.success || output === undefined) {
      const reasons = result.logs.map((log) => String(log)).join('\n');

      console.error(
        `[VizBuilder.bundleClient] failed to bundle ${relative(OkfProject.read().root, CLIENT_ENTRY)}\n${reasons}`,
      );
      process.exit(1);
    }

    return output.text();
  }
}

export const buildViz = async (): Promise<void> => {
  const data = VizBuilder.buildData({ concepts: ConceptLoader.loadOrExit() });
  const clientScript = await VizBuilder.bundleClient();
  const html = VizBuilder.assembleHtml({
    template: readFileSync(TEMPLATE_FILE, 'utf8'),
    data,
    clientScript,
  });

  const project = OkfProject.read();

  // The same page to every configured output (the bundle's copy, a wiki's public copy, ...).
  for (const out of project.viz.outputs) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html);

    console.log(`viz: wrote ${relative(project.root, out)}`);
  }
  console.log(
    `viz: ${data.nodes.length} nodes, ${data.edges.length} edges, ${data.sections.length} sections`,
  );
};
