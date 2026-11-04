import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BoardFold } from '../../board/fold.ts';
import { BoardPage } from '../../board/page.ts';
import type { IBoardData } from '../../board/common/index.ts';
import { BrowserPage } from '../visualize/browser.helper.ts';
import { line, sampleLines } from './log-lines.helper.ts';
import { sampleData } from './sample-data.helper.ts';

const TEMPLATE = readFileSync(
  join(import.meta.dir, '..', '..', '..', 'base', 'templates', 'board.html'),
  'utf8',
);
const hasBrowser = await BrowserPage.available();

afterAll(() => BrowserPage.close());

/** Every dotted key the page asks for: `data-i18n`, `data-i18n-aria-label` and `t('x.y')`. */
const keysUsed = (): string[] => {
  const found = new Set<string>();

  for (const match of TEMPLATE.matchAll(/data-i18n(?:-aria-label)?="([a-z][\w]*\.[\w.]+)"/g)) {
    found.add(match[1]);
  }

  for (const match of TEMPLATE.matchAll(/\bt\('([a-z][\w]*\.[\w.]+)'\)/g)) {
    found.add(match[1]);
  }

  // Keys kept in a table or built from a kind, such as the verbs of the "Latest" lines: written out in the template.
  for (const match of TEMPLATE.matchAll(/'((?:lt|ctx|nx|nw)\.[\w.]+)'/g)) {
    found.add(match[1]);
  }

  return [...found].sort();
};

describe('the keys of the page are all defined', () => {
  test('every dotted key it asks for has an English and a Vietnamese text', () => {
    const keys = keysUsed();

    expect(keys.length).toBeGreaterThan(10);

    for (const key of keys) {
      expect(TEMPLATE, `English text of ${key}`).toContain(`DICT.en['${key}']`);
      expect(TEMPLATE, `Vietnamese text of ${key}`).toContain(`DICT.vi['${key}']`);
    }
  });
});

describe('the page before any script runs (a viewer without scripts, or a script that stops early)', () => {
  const page = (): string =>
    BoardPage.render({ data: sampleData({ base: Date.now() - 60 * 60_000 }) });
  const markup = (): string =>
    page()
      .split('<body>')[1]
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<style[\s\S]*?<\/style>/g, '');

  test('no text and no label is a dotted key', () => {
    const texts = [...markup().matchAll(/>([^<>]+)</g)]
      .map((match) => match[1].trim())
      .filter((text) => text !== '');
    const labels = [
      ...markup().matchAll(/(?<![-\w])(?:aria-label|title|placeholder|alt)="([^"]*)"/g),
    ].map((match) => match[1]);

    expect([...texts, ...labels].filter((text) => /^[a-z]\w*\.[\w.]+$/.test(text))).toEqual([]);
  });

  test('the text is the English one, not the Vietnamese key it is looked up by', () => {
    const texts = [...markup().matchAll(/>([^<>]+)</g)].map((match) => match[1].trim());
    const labels = [
      ...markup().matchAll(/(?<![-\w])(?:aria-label|title|placeholder|alt)="([^"]*)"/g),
    ].map((match) => match[1]);

    expect([...texts, ...labels].filter((text) => /[À-ỹ]/.test(text))).toEqual([]);
  });
});

/** A day of work with many lines: every kind the log has, many flows, many agents, and a pull request that merged. */
const busyData = (): IBoardData => {
  const base = Date.now() - 300 * 60_000;
  const lines = sampleLines({ base });
  const agents = ['pnt-a-1', 'pnt-b-1', 'pnt-c-1', 'pnt-d-1', 'bana-forge', 'worker-9'];

  for (let flow = 6; flow < 40; flow++) {
    const actor = agents[flow % agents.length];

    lines.push(
      line({ base, minute: flow * 3, kind: 'session-start', actor, summary: 'startup' }),
      line({
        base,
        minute: flow * 3 + 1,
        kind: 'commit',
        actor,
        flow: `F-${flow}`,
        summary: `work on flow ${flow}`,
        ref: `c${flow}`,
      }),
      line({
        base,
        minute: flow * 3 + 2,
        kind: 'msg-sent',
        actor,
        flow: `F-${flow}`,
        summary: 'status',
        ref: 'to:veni-forge',
      }),
    );

    if (flow % 4 === 0) {
      lines.push(
        line({
          base,
          minute: flow * 3 + 2,
          kind: 'needs-owner',
          actor,
          flow: `F-${flow}`,
          summary: 'Which way?',
        }),
      );
    }

    if (flow % 5 === 0) {
      lines.push(
        line({
          base,
          minute: flow * 3 + 2,
          kind: 'pr',
          actor,
          flow: `F-${flow}`,
          summary: 'merged',
          ref: `merged:${flow}`,
        }),
      );
    }
  }

  lines.push(
    line({ base, minute: 250, kind: 'subagent-stop', actor: 'worker-9', summary: 'Explore a1' }),
    line({ base, minute: 251, kind: 'session-stop', actor: 'worker-9', summary: 'turn ended' }),
  );

  const log = BoardFold.fromLog({ events: lines });
  const { flows, decisions } = BoardFold.fold({ events: log.events, owner: 'Ana' });

  return { ...sampleData({ base }), flows, decisions, agents: log.agents };
};

interface ISweep {
  errors: string[];
  /** Strings on the page that are a key and not its text. */
  raw: { where: string; text: string }[];
  steps: string[];
}

/**
 * Runs in the page: goes through the list, the diagram, the board, the agent graph, a detail pane, the popup of an agent
 * and the keys dialog; after each step it reads every text and every label, and reports what is a dotted key, or a key of
 * the English dictionary shown in English as itself (a Vietnamese key left as it was).
 */
const SWEEP = (lang: string) => `(async () => {
  const wait = () => new Promise((resolve) => setTimeout(resolve, 60));
  while (document.documentElement.lang !== undefined && (typeof lang === 'undefined' ? '' : lang) !== '${lang}') {
    document.getElementById('bLang').click();
    await wait();
  }
  const raw = [];
  const steps = [];
  const dotted = /^[a-z][\\w]*\\.[\\w.]+$/;
  const sweep = (step) => {
    steps.push(step);
    const seen = [];
    for (const node of document.querySelectorAll('body *')) {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) seen.push(child.textContent.trim());
      }
      for (const name of ['aria-label', 'title', 'placeholder', 'alt']) {
        const value = node.getAttribute(name);
        if (value) seen.push(value.trim());
      }
    }
    for (const text of seen) {
      if (text === '') continue;
      const english = '${lang}' === 'en' && Object.prototype.hasOwnProperty.call(DICT.en, text) && DICT.en[text] !== text && /[^\\x00-\\x7f]/.test(text);
      if (dotted.test(text) || english) raw.push({ where: step, text });
    }
  };
  await wait();
  sweep('list');
  for (const mode of ['diagram', 'board', 'list']) {
    document.querySelector('#vmode button[data-mode="' + mode + '"], #vmode button:nth-child(' + (['list', 'diagram', 'board'].indexOf(mode) + 1) + ')').click();
    await wait();
    sweep('view ' + mode);
  }
  document.querySelector('.row').click();
  await wait();
  sweep('detail');
  document.getElementById('tAgents').click();
  await wait();
  await wait();
  sweep('agents');
  const node = document.querySelector('#graph .node');
  if (node) { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); await wait(); sweep('graph pick'); }
  document.getElementById('tFlows').click();
  await wait();
  const cell = document.querySelector('#dock .cell');
  if (cell) { cell.click(); await wait(); sweep('popup'); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); }
  document.getElementById('bPlumb').click();
  await wait();
  document.querySelector('.row').click();
  await wait();
  sweep('all events');
  document.getElementById('bPlumb').click();
  await wait();
  document.getElementById('bKeys').click();
  await wait();
  sweep('keys');
  return JSON.stringify({ errors: window.__errs, raw, steps });
})()`;

describe.skipIf(!hasBrowser)(
  'the rendered page shows no raw key, in either language and theme',
  () => {
    const html = BoardPage.render({ data: busyData() }).replace(
      '<script type="application/json"',
      '<script>window.__errs=[];addEventListener("error",(e)=>__errs.push(e.message))</script><script type="application/json"',
    );

    for (const lang of ['en', 'vi']) {
      for (const dark of [false, true]) {
        test(`${lang}, ${dark ? 'dark' : 'light'}: every text and label is translated, in every view`, async () => {
          const result2 = await BrowserPage.measure<string>({
            html,
            width: 1440,
            dark,
            expression: SWEEP(lang),
          });
          const result = JSON.parse(result2) as ISweep;

          expect(result.errors).toEqual([]);
          expect(result.steps).toEqual([
            'list',
            'view diagram',
            'view board',
            'view list',
            'detail',
            'agents',
            'graph pick',
            'popup',
            'all events',
            'keys',
          ]);
          expect(result.raw).toEqual([]);
        });
      }
    }
  },
);
