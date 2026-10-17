import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';

import { VizConstants } from '../common/index.ts';
import type { IVizData } from '../common/index.ts';
import { KnowledgeExplorer } from './explorer.ts';
import type { IExplorerElements } from './explorer.ts';
import { resolveLocale } from './strings.ts';

const ELEMENT_IDS = [
  'side',
  'stage',
  'reader',
  'mapwrap',
  'cy',
  'maphint',
  'search',
  'brand',
] as const;

/** Every element the template must carry; a missing one is reported by name, never thrown on. */
const collectElements = (): IExplorerElements | undefined => {
  const byId = new Map(ELEMENT_IDS.map(id => [id, document.getElementById(id)]));
  const missing = ELEMENT_IDS.filter(id => byId.get(id) === null);
  const search = byId.get('search');

  if (missing.length > 0 || !(search instanceof HTMLInputElement)) {
    console.error(
      `[collectElements] the page template is missing elements | ids: ${missing.join(', ') || 'search (not an <input>)'}`,
    );

    return undefined;
  }

  const read = (id: (typeof ELEMENT_IDS)[number]): HTMLElement => byId.get(id) ?? document.body;

  return {
    side: read('side'),
    stage: read('stage'),
    reader: read('reader'),
    mapWrap: read('mapwrap'),
    graph: read('cy'),
    mapHint: read('maphint'),
    search,
    brand: read('brand'),
    viewButtons: [...document.querySelectorAll<HTMLButtonElement>('.seg button')],
  };
};

const readData = (): IVizData | undefined => {
  const text = document.getElementById(VizConstants.DATA_ELEMENT_ID)?.textContent;

  if (!text) {
    console.error(`[readData] no #${VizConstants.DATA_ELEMENT_ID} element with the bundle data`);

    return undefined;
  }

  const data: IVizData = JSON.parse(text);

  return data;
};

cytoscape.use(fcose);

const elements = collectElements();
const data = readData();

if (elements && data) {
  new KnowledgeExplorer({ data, elements, locale: resolveLocale() }).start();
}
