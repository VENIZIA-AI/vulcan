import cytoscape from 'cytoscape';
import type cytoscapeFcose from 'cytoscape-fcose';

import { VizConstants, VizViews } from '../common/index.ts';
import type { IVizCopy, IVizData, IVizNode, TLocale, TVizView } from '../common/index.ts';
import { escapeAttribute, escapeHtml } from './html.ts';
import { renderMarkdown } from './markdown.ts';
import { UI_STRINGS } from './strings.ts';
import type { IUiStrings } from './strings.ts';
import { VizTheme } from './theme.ts';

export interface IExplorerElements {
  side: HTMLElement;
  stage: HTMLElement;
  reader: HTMLElement;
  mapWrap: HTMLElement;
  graph: HTMLElement;
  mapHint: HTMLElement;
  search: HTMLInputElement;
  brand: HTMLElement;
  viewButtons: HTMLButtonElement[];
}

const SECTION_NODE_PREFIX = 'sec:';

const FCOSE_LAYOUT: cytoscapeFcose.FcoseLayoutOptions = {
  name: 'fcose',
  quality: 'default',
  animate: false,
  randomize: true,
  padding: 40,
  nodeSeparation: 150,
  idealEdgeLength: 78,
  nodeRepulsion: 7000,
  gravity: 0.2,
  gravityCompound: 3,
  gravityRangeCompound: 1.6,
  packComponents: true,
  tile: true,
  numIter: 2500,
};

/** Search weight per field: an exact title beats a title hit, which beats tags, description, body. */
const scoreNode = (opts: { node: IVizNode; query: string }): number => {
  const { node, query } = opts;
  const title = node.title.toLowerCase();
  let score = 0;

  if (title === query) {
    score += 10;
  }

  if (title.includes(query)) {
    score += 5;
  }

  if (node.tags.join(' ').toLowerCase().includes(query)) {
    score += 3;
  }

  if (node.description.toLowerCase().includes(query)) {
    score += 2;
  }

  if (node.body.toLowerCase().includes(query)) {
    score += 1;
  }

  return score;
};

export class KnowledgeExplorer {
  private view: TVizView = VizViews.READ;
  private graph: cytoscape.Core | undefined;
  private readonly sectionColors = new Map<string, string>();
  private readonly nodeById: Map<string, IVizNode>;
  private readonly neighbours: Map<string, Set<string>>;
  private readonly strings: IUiStrings;
  private readonly copy: IVizCopy;

  constructor(
    private readonly opts: { data: IVizData; elements: IExplorerElements; locale: TLocale },
  ) {
    this.strings = UI_STRINGS[opts.locale];
    this.copy = opts.data.copy[opts.locale];
    this.nodeById = new Map(opts.data.nodes.map(node => [node.id, node]));
    this.neighbours = new Map(opts.data.nodes.map(node => [node.id, new Set<string>()]));

    for (const edge of opts.data.edges) {
      this.neighbours.get(edge.source)?.add(edge.target);
      this.neighbours.get(edge.target)?.add(edge.source);
    }
  }

  start(): void {
    VizTheme.apply();
    this.computeSectionColors();
    this.opts.elements.search.placeholder = this.strings.search;
    this.renderSidebar();
    this.bindEvents();
    this.openHome();
    VizTheme.watch({ onChange: () => this.restyle() });
  }

  private computeSectionColors(): void {
    const { sections } = this.opts.data;

    sections.forEach((section, index) => {
      this.sectionColors.set(
        section.key,
        VizTheme.getSectionColor({ index, total: sections.length }),
      );
    });
  }

  private getSectionColor(opts: { key: string }): string {
    return this.sectionColors.get(opts.key) ?? '';
  }

  private restyle(): void {
    this.computeSectionColors();
    this.graph?.style(this.buildGraphStyle());
  }

  private getNodesInSection(opts: { key: string }): IVizNode[] {
    return this.opts.data.nodes
      .filter(node => node.group === opts.key)
      .sort((left, right) => left.title.localeCompare(right.title));
  }

  private renderSidebar(): void {
    const { side } = this.opts.elements;

    side.replaceChildren();

    for (const section of this.opts.data.sections) {
      const color = this.getSectionColor({ key: section.key });
      const group = document.createElement('div');

      group.className = 'grp';
      group.dataset.key = section.key;

      const header = document.createElement('div');

      header.className = 'gh';
      header.innerHTML =
        `<span class="gbar" style="background:${color}"></span>` +
        `<span class="gname">${escapeHtml({ text: section.label })}</span><span class="gn">${section.count}</span>`;
      header.addEventListener('click', () => group.classList.toggle('col'));

      const items = document.createElement('div');

      items.className = 'items';

      for (const node of this.getNodesInSection({ key: section.key })) {
        const item = document.createElement('div');

        item.className = 'it';
        item.dataset.id = node.id;
        item.dataset.query =
          `${node.title} ${node.description} ${node.tags.join(' ')} ${node.body}`.toLowerCase();
        item.style.setProperty('--accent', color);
        item.innerHTML = `<span class="d"></span>${escapeHtml({ text: node.title })}`;
        item.addEventListener('click', () => this.openConcept({ id: node.id }));
        items.append(item);
      }

      group.append(header, items);
      side.append(group);
    }
  }

  private findSidebarGroup(opts: { key: string }): HTMLElement | undefined {
    return [...this.opts.elements.side.querySelectorAll<HTMLElement>('.grp')].find(
      group => group.dataset.key === opts.key,
    );
  }

  private setActive(opts: { id?: string }): void {
    for (const item of this.opts.elements.side.querySelectorAll<HTMLElement>('.it')) {
      item.classList.toggle('on', item.dataset.id === opts.id);
    }
  }

  private showView(opts: { view: TVizView }): void {
    const { reader, mapWrap, viewButtons } = this.opts.elements;

    this.view = opts.view;
    reader.style.display = opts.view === VizViews.READ ? '' : 'none';
    mapWrap.style.display = opts.view === VizViews.MAP ? 'block' : 'none';

    for (const button of viewButtons) {
      button.classList.toggle('on', button.dataset.v === opts.view);
    }

    if (opts.view === VizViews.MAP) {
      this.initMap();
    }
  }

  private openHome(): void {
    this.showView({ view: VizViews.READ });
    this.setActive({});

    const cards = this.opts.data.sections
      .map(section => {
        const nodes = this.getNodesInSection({ key: section.key });
        const hidden = nodes.length - VizConstants.HOME_CARD_ITEMS;
        const links = nodes
          .slice(0, VizConstants.HOME_CARD_ITEMS)
          .map(
            node =>
              `<a data-go="${escapeAttribute({ text: node.id })}">${escapeHtml({ text: node.title })}</a>`,
          )
          .join('');

        return (
          `<div class="card" style="--accent:${this.getSectionColor({ key: section.key })}" data-sec="${escapeAttribute({ text: section.key })}">` +
          `<div class="ch"><span class="ck">${escapeHtml({ text: section.label })}</span><span class="cn">${section.count}</span></div>` +
          `<div class="cd">${escapeHtml({ text: this.copy.sectionDescriptions[section.key] ?? '' })}</div>` +
          `<div class="cl">${links}</div>` +
          (hidden > 0
            ? `<div class="more">${this.strings.formatMore({ count: hidden })}</div>`
            : '') +
          '</div>'
        );
      })
      .join('');

    const { nodes, sections } = this.opts.data;

    this.opts.elements.reader.innerHTML =
      `<div class="hero"><div class="eyebrow">${escapeHtml({ text: this.strings.start })}</div>` +
      `<h1>${escapeHtml({ text: this.copy.heading })}</h1>` +
      `<p>${escapeHtml({ text: this.copy.tagline })} ${nodes.length} ${this.strings.concepts} · ${sections.length} ${this.strings.areas}.</p></div>` +
      `<div class="grid">${cards}</div>`;
    this.scrollToTop();
  }

  private openConcept(opts: { id: string }): void {
    const node = this.nodeById.get(opts.id);

    if (!node) {
      return;
    }

    this.showView({ view: VizViews.READ });
    this.setActive({ id: node.id });

    const label =
      this.opts.data.sections.find(section => section.key === node.group)?.label ?? node.group;
    const accent = this.getSectionColor({ key: node.group });
    const related = [...(this.neighbours.get(node.id) ?? [])]
      .map(id => this.nodeById.get(id))
      .filter((neighbour): neighbour is IVizNode => neighbour !== undefined)
      .sort((left, right) => left.title.localeCompare(right.title));

    const chips = related
      .map(
        neighbour =>
          `<span class="chip" data-go="${escapeAttribute({ text: neighbour.id })}">` +
          `<span class="d" style="background:${this.getSectionColor({ key: neighbour.group })}"></span>${escapeHtml({ text: neighbour.title })}</span>`,
      )
      .join('');

    this.opts.elements.reader.innerHTML =
      `<div class="crumb"><a data-go="${VizConstants.HOME_TARGET}">${escapeHtml({ text: this.strings.start })}</a> / ` +
      `<a data-sec="${escapeAttribute({ text: node.group })}">${escapeHtml({ text: label })}</a> / ${escapeHtml({ text: node.title })}</div>` +
      `<div class="doc" style="--accent:${accent}">` +
      `<span class="badge" style="background:${accent}">${escapeHtml({ text: node.type })}</span>` +
      `<h1>${escapeHtml({ text: node.title })}</h1><p class="lead">${escapeHtml({ text: node.description })}</p>` +
      (node.tags.length
        ? `<div class="tags">#${node.tags.map(tag => escapeHtml({ text: tag })).join('  #')}</div>`
        : '') +
      (node.resource
        ? `<div class="src">${escapeHtml({ text: this.strings.source })}: ${escapeHtml({ text: node.resource })}</div>`
        : '') +
      `<div class="body">${renderMarkdown({ source: node.body })}</div>` +
      (related.length
        ? `<div class="related"><div class="rh">${escapeHtml({ text: this.strings.related })}</div><div class="chips">${chips}</div></div>`
        : '') +
      '</div>';

    const group = this.findSidebarGroup({ key: node.group });

    if (group) {
      group.classList.remove('col');
      group.querySelector('.it.on')?.scrollIntoView({ block: 'nearest' });
    }

    this.opts.elements.stage.scrollTop = 0;
  }

  private openSection(opts: { key: string }): void {
    this.openHome();

    const target = this.findSidebarGroup({ key: opts.key });

    if (!target) {
      return;
    }

    for (const group of this.opts.elements.side.querySelectorAll<HTMLElement>('.grp')) {
      group.classList.toggle('col', group !== target);
    }

    target.scrollIntoView({ block: 'start' });
  }

  private runSearch(): void {
    const { side, search, reader } = this.opts.elements;
    const query = search.value.toLowerCase().trim();

    for (const item of side.querySelectorAll<HTMLElement>('.it')) {
      item.classList.toggle('hide', query !== '' && !(item.dataset.query ?? '').includes(query));
    }

    for (const group of side.querySelectorAll<HTMLElement>('.grp')) {
      const anyVisible = [...group.querySelectorAll('.it')].some(
        item => !item.classList.contains('hide'),
      );

      group.style.display = query === '' || anyVisible ? '' : 'none';
    }

    if (this.view === VizViews.MAP) {
      return;
    }

    if (query === '') {
      this.openHome();

      return;
    }

    const hits = this.opts.data.nodes
      .map(node => ({ node, score: scoreNode({ node, query }) }))
      .filter(hit => hit.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, VizConstants.SEARCH_RESULT_LIMIT);

    this.showView({ view: VizViews.READ });
    const count = hits.length
      ? this.strings.formatResults({ count: hits.length })
      : this.strings.none;

    reader.innerHTML =
      `<div class="results"><div class="rcount">${escapeHtml({ text: count })}</div>` +
      hits
        .map(
          ({ node }) =>
            `<div class="res" style="--accent:${this.getSectionColor({ key: node.group })}" data-go="${escapeAttribute({ text: node.id })}">` +
            `<span class="rt">${escapeHtml({ text: node.title })}</span><span class="rk">${escapeHtml({ text: node.type })}</span>` +
            `<div class="rd">${escapeHtml({ text: node.description })}</div></div>`,
        )
        .join('') +
      '</div>';
    this.scrollToTop();
  }

  private scrollToTop(): void {
    this.opts.elements.reader.scrollTop = 0;
    this.opts.elements.stage.scrollTop = 0;
  }

  private bindEvents(): void {
    const { search, brand, viewButtons } = this.opts.elements;

    search.addEventListener('input', () => this.runSearch());

    brand.addEventListener('click', () => {
      search.value = '';
      this.runSearch();
    });

    for (const button of viewButtons) {
      button.addEventListener('click', () => {
        const view = button.dataset.v ?? '';

        if (VizViews.isValid(view)) {
          this.showView({ view: view === VizViews.MAP ? VizViews.MAP : VizViews.READ });
        }
      });
    }

    document.addEventListener('click', event => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const link = event.target.closest<HTMLElement>('[data-go]');

      if (link) {
        event.preventDefault();
        const id = link.dataset.go ?? '';

        if (id === VizConstants.HOME_TARGET) {
          this.openHome();

          return;
        }

        this.openConcept({ id });

        return;
      }

      const section = event.target.closest<HTMLElement>('[data-sec]');

      if (section) {
        event.preventDefault();
        this.openSection({ key: section.dataset.sec ?? '' });
      }
    });
  }

  private buildGraphStyle(): cytoscape.StylesheetJson {
    const readVariable = (name: string): string => VizTheme.readVariable({ name });

    return [
      {
        selector: 'node[kind="section"]',
        style: {
          'background-opacity': 0.04,
          'background-color': VizTheme.isDark() ? '#fff' : '#000',
          'border-width': 1.5,
          'border-color': readVariable('--border'),
          'border-style': 'dashed',
          shape: 'round-rectangle',
          label: 'data(label)',
          'text-valign': 'top',
          'text-halign': 'center',
          'font-family': 'monospace',
          'font-size': 12,
          'font-weight': 700,
          color: readVariable('--text-2'),
          'text-margin-y': -6,
          padding: '24px',
          'corner-radius': '14',
          'text-background-color': readVariable('--bg'),
          'text-background-opacity': 0.85,
          'text-background-padding': '4px',
        },
      },
      {
        selector: 'node[!kind]',
        style: {
          'background-color': 'data(color)',
          width: 'mapData(degree, 0, 12, 18, 46)',
          height: 'mapData(degree, 0, 12, 18, 46)',
          'border-width': 1.5,
          'border-color': readVariable('--bg'),
          label: 'data(label)',
          'font-size': 9.5,
          color: readVariable('--text'),
          'text-valign': 'bottom',
          'text-margin-y': 2,
          'text-outline-color': readVariable('--bg'),
          'text-outline-width': 2,
          'min-zoomed-font-size': 6,
        },
      },
      {
        selector: 'edge',
        style: {
          width: 1.2,
          'line-color': readVariable('--text-2'),
          'curve-style': 'bezier',
          opacity: 0.32,
        },
      },
      { selector: '.dim', style: { opacity: 0.08 } },
      { selector: '.hl', style: { 'line-color': readVariable('--brand'), opacity: 1, width: 2 } },
    ];
  }

  private initMap(): void {
    this.opts.elements.mapHint.textContent = this.strings.mapHint;

    if (this.graph) {
      return;
    }

    const { nodes, edges, sections } = this.opts.data;
    const elements: cytoscape.ElementDefinition[] = [
      ...sections.map(section => ({
        data: {
          id: `${SECTION_NODE_PREFIX}${section.key}`,
          label: section.label.toUpperCase(),
          kind: 'section',
        },
      })),
      ...nodes.map(node => ({
        data: {
          id: node.id,
          label: node.title,
          parent: `${SECTION_NODE_PREFIX}${node.group}`,
          color: this.getSectionColor({ key: node.group }),
          degree: node.degree,
        },
      })),
      ...edges.map(edge => ({
        data: { id: `${edge.source}>${edge.target}`, source: edge.source, target: edge.target },
      })),
    ];

    const graph = cytoscape({
      container: this.opts.elements.graph,
      elements,
      style: this.buildGraphStyle(),
      minZoom: 0.1,
      maxZoom: 3,
      layout: FCOSE_LAYOUT,
    });

    graph.on('tap', 'node[!kind]', event => this.openConcept({ id: event.target.id() }));
    graph.on('mouseover', 'node[!kind]', event => {
      const neighbourhood = event.target.closedNeighborhood();

      graph.elements().difference(neighbourhood).addClass('dim');
      neighbourhood.edgesWith(event.target).addClass('hl');
    });
    graph.on('mouseout', 'node[!kind]', () => graph.elements().removeClass('dim hl'));
    graph.ready(() => graph.fit(undefined, 40));

    this.graph = graph;
  }
}
