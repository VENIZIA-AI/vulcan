import { describe, expect, test } from 'bun:test';
import { assembleVizHtml, bundleVizClient } from '../../viz/builder.ts';
import { VizConstants, VizTemplateTokens } from '../../viz/common/index.ts';
import type { IVizData } from '../../viz/common/index.ts';

const TEMPLATE = `<title>${VizTemplateTokens.BRAND}</title><script type="application/json" id="${VizConstants.DATA_ELEMENT_ID}">${VizTemplateTokens.DATA}</script><script>${VizTemplateTokens.CLIENT}</script>`;

const DATA: IVizData = {
  brand: 'IGNIS',
  nodes: [
    {
      id: '/a',
      type: 'T',
      title: 'A',
      description: 'd',
      resource: '',
      tags: [],
      body: 'ends </script> here',
      group: 'packages',
      degree: 0,
    },
  ],
  edges: [],
  sections: [{ key: 'packages', label: 'Packages', count: 1 }],
  copy: {
    en: { heading: 'h', tagline: 't', sectionDescriptions: {} },
    vi: { heading: 'h', tagline: 't', sectionDescriptions: {} },
  },
};

describe('assembleVizHtml', () => {
  test('fills every token and leaves none behind', () => {
    const html = assembleVizHtml({ template: TEMPLATE, data: DATA, clientScript: 'boot();' });

    expect(html).not.toContain('__OKF_');
    expect(html).toContain('<title>IGNIS</title>');
    expect(html).toContain('<script>boot();</script>');
  });

  test('a </script> inside the data cannot close the data element, and the JSON still parses', () => {
    const html = assembleVizHtml({ template: TEMPLATE, data: DATA, clientScript: '' });

    expect(html.match(/<\/script>/g)).toHaveLength(2);
    const json = html.slice(
      html.indexOf('>', html.indexOf(VizConstants.DATA_ELEMENT_ID)) + 1,
      html.indexOf('</script>'),
    );

    expect(JSON.parse(json).nodes[0].body).toBe('ends </script> here');
  });

  test('a </script> inside the client cannot close the client element', () => {
    const html = assembleVizHtml({
      template: TEMPLATE,
      data: DATA,
      clientScript: 'const s = "</script>";',
    });

    expect(html.match(/<\/script>/g)).toHaveLength(2);
  });

  test('a $ pattern in the data is inserted literally, never as a replacement pattern', () => {
    const data = { ...DATA, brand: "$1 $' $`" };

    expect(assembleVizHtml({ template: TEMPLATE, data, clientScript: '' })).toContain(
      "<title>$1 $' $`</title>",
    );
  });

  test('the brand is HTML-escaped where it lands in markup', () => {
    const data = { ...DATA, brand: 'R&D <x>' };

    expect(assembleVizHtml({ template: TEMPLATE, data, clientScript: '' })).toContain(
      '<title>R&amp;D &lt;x&gt;</title>',
    );
  });
});

describe('bundleVizClient', () => {
  test('bundles the browser client, Cytoscape and fcose into one import-free script', async () => {
    const script = await bundleVizClient();

    expect(script.length).toBeGreaterThan(100_000);
    expect(script).not.toMatch(/^\s*import\s/m);
  });
});
