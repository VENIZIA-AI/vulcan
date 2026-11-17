import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BoardCommand } from '../../board/command.ts';
import { BoardPage } from '../../board/page.ts';
import { BoardServer } from '../../board/server.ts';
import { EventLog } from '../../events/log.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { BrowserPage } from '../visualize/browser.helper.ts';
import { line, sampleLines } from './log-lines.helper.ts';
import { sampleData } from './sample-data.helper.ts';

const hasBrowser = await BrowserPage.available();

afterAll(async () => {
  await BoardServer.stop();
  await BrowserPage.close();
  removeProjects();
});
afterEach(() => BoardServer.stop());

const SINCE = Date.parse('2026-11-01');
/** The page counts an agent not heard from in a day as earlier, by the real clock: the lines of a test are laid out from now, never from a fixed date. */
const SAMPLE_SPAN_MINUTES = 400; // above the minute of the new agent (300), so its line is in the past, and under a day less the spread of the sample (90)

/** Resolves when `condition` holds in the page, or after `ms`; the answer is the page's own view of it. */
const WAIT = (condition: string, ms: number): string => `(async () => {
  const until = Date.now() + ${ms};
  while (Date.now() < until && !(${condition})) await new Promise((resolve) => setTimeout(resolve, 50));
})()`;

describe.skipIf(!hasBrowser)('the served board in a real browser', () => {
  test('a new line of the log shows with no reload, and what the owner selected stays', async () => {
    const root = createProject({
      files: { '.agents/vulcan.manifest.json': '{}', '.git/HEAD': 'ref: refs/heads/x\n' },
    });
    const dir = join(root, '.agents/local/events');

    const base = Date.now() - SAMPLE_SPAN_MINUTES * 60_000;

    for (const event of sampleLines({ base })) {
      EventLog.append({ dir, event });
    }

    const server = await BoardServer.start({
      port: 0,
      dir,
      collect: () =>
        BoardCommand.collect({ root, dir, since: SINCE, args: { repos: [], noGithub: true } }),
    });
    const opened = await BrowserPage.measure<string>({
      url: server.url,
      width: 1440,
      dark: false,
      expression: `(async () => {
        await ${WAIT("document.getElementById('fresh').textContent.includes('live')", 5000)};
        window.__marker = 'the same page';
        const row = document.querySelector('.row');
        row.click();
        window.__selected = row.dataset.id;
        return JSON.stringify({
          agents: [...document.querySelectorAll('#dock [data-agent]')].map((c) => c.dataset.agent),
          fresh: document.getElementById('fresh').textContent,
          errors: window.__errs || [],
        });
      })()`,
    });
    const before: { agents: string[]; fresh: string } = JSON.parse(opened);

    expect(before.fresh).toContain('live');
    expect(before.agents).not.toContain('brand-new-agent');

    EventLog.append({
      dir,
      event: line({
        base,
        minute: 300,
        kind: 'commit',
        actor: 'brand-new-agent',
        flow: 'F-9',
        summary: 'appears with no reload',
        ref: 'eeee111',
      }),
    });

    const result = await BrowserPage.evaluate({
      expression: `(async () => {
            await ${WAIT("[...document.querySelectorAll('#dock [data-agent]')].some((c) => c.dataset.agent === 'brand-new-agent')", 8000)};
            return JSON.stringify({
              marker: window.__marker,
              selected: window.__selected,
              agents: [...document.querySelectorAll('#dock [data-agent]')].map((c) => c.dataset.agent),
              flows: [...document.querySelectorAll('.row')].map((row) => row.dataset.id),
              stillSelected: document.querySelector('.row[aria-selected="true"]')?.dataset.id,
              inCard: await (async () => {
                document.querySelector('#dock [data-agent][data-agent="brand-new-agent"]').click();
                await new Promise((resolve) => setTimeout(resolve, 100));

                return document.getElementById('detail').textContent.includes('appears with no reload');
              })(),
              navigations: performance.getEntriesByType('navigation').length,
            });
          })()`,
    });
    const after: {
      marker: string;
      selected: string;
      agents: string[];
      flows: string[];
      navigations: number;
      stillSelected: string | undefined;
      inCard: boolean;
    } = JSON.parse(result);

    expect(after.marker, 'the page was reloaded').toBe('the same page');
    expect(after.navigations).toBe(1);
    expect(after.agents).toContain('brand-new-agent');
    expect(after.flows).toContain('F-9');
    expect(after.stillSelected, 'what the owner selected is lost').toBe(after.selected);
    expect(after.inCard, 'the event list the graph and the card read is stale').toBe(true);
  });

  test('when the server stops the page says it is disconnected, and keeps showing the board', async () => {
    const root = createProject({ files: { '.agents/vulcan.manifest.json': '{}' } });
    const dir = join(root, '.agents/local/events');

    EventLog.append({
      dir,
      event: line({
        minute: 1,
        kind: 'commit',
        actor: 'a',
        flow: 'F-1',
        summary: 's',
        ref: 'abc1234',
      }),
    });

    const server = await BoardServer.start({
      port: 0,
      dir,
      collect: () =>
        BoardCommand.collect({ root, dir, since: SINCE, args: { repos: [], noGithub: true } }),
    });

    await BrowserPage.measure<string>({
      url: server.url,
      width: 1440,
      dark: false,
      expression: `(async () => { await ${WAIT("document.getElementById('fresh').textContent.includes('live')", 5000)}; return 'ok'; })()`,
    });
    await BoardServer.stop();

    const result = await BrowserPage.evaluate({
      expression: `(async () => {
          await ${WAIT("document.getElementById('fresh').textContent.includes('disconnected')", 8000)};
          return JSON.stringify({
            fresh: document.getElementById('fresh').textContent,
            flows: document.querySelectorAll('.row').length,
            body: document.body.innerText.length > 200,
          });
        })()`,
    });
    const seen: { fresh: string; flows: number; body: boolean } = JSON.parse(result);

    expect(seen.fresh).toContain('disconnected, retrying');
    expect(seen.flows).toBe(1);
    expect(seen.body, 'the page went blank').toBe(true);
  });

  test('a stream that keeps dropping is retried with a growing wait, and a message resets it', async () => {
    const data = {
      ...sampleData({ base: Date.now() - 100 * 60_000 }),
      live: { stream: '/stream?t=x' },
    };
    const stub = `<script>
      window.__sources = [];
      window.EventSource = class {
        constructor(url) { this.url = url; this.at = Date.now(); this.closed = false; window.__sources.push(this); }
        close() { this.closed = true; }
      };
    </script>`;
    const html = BoardPage.render({ data }).replace(
      '<script type="application/json"',
      `${stub}<script type="application/json"`,
    );
    const raw = await BrowserPage.measure<string>({
      html,
      width: 1440,
      dark: false,
      expression: `(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const drop = async () => {
          const dropped = Date.now();
          const count = window.__sources.length;
          window.__sources.at(-1).onerror();
          await ${WAIT('window.__sources.length > count', 6000)};
          return window.__sources.at(-1).at - dropped;
        };
        const started = window.__sources.length;
        const first = await drop();
        const afterOne = document.getElementById('fresh').textContent;
        const second = await drop();
        window.__sources.at(-1).onmessage({ data: JSON.stringify(${JSON.stringify(data)}) });
        await sleep(100);
        const live = document.getElementById('fresh').textContent;
        const third = await drop();
        return JSON.stringify({ started, count: window.__sources.length, afterOne, live, waits: [first, second, third] });
      })()`,
    });
    const seen: {
      started: number;
      count: number;
      afterOne: string;
      live: string;
      waits: number[];
    } = JSON.parse(raw);

    expect(seen.started).toBe(1);
    expect(seen.afterOne).toContain('disconnected');
    expect(seen.live).toContain('live');
    expect(seen.count).toBe(4);
    expect(seen.waits[0]).toBeGreaterThanOrEqual(900);
    expect(seen.waits[0]).toBeLessThan(1800);
    expect(seen.waits[1], 'the second drop waits about twice as long').toBeGreaterThanOrEqual(1900);
    expect(seen.waits[2], 'a message in between resets the wait').toBeLessThan(1800);
  });

  test('a snapshot that carries a roster and lanes reorders the cards and labels the helper; nobody goes', async () => {
    const data = {
      ...sampleData({ base: Date.now() - 100 * 60_000 }),
      live: { stream: '/stream?t=x' },
    };
    const next = {
      ...data,
      roster: ['veni-forge', 'pnt-vulcan-1'],
      lanes: { 'pnt-ignis-1': 'pnt-vulcan-1' },
    };
    const stub = `<script>
      window.__sources = [];
      window.EventSource = class { constructor() { window.__sources.push(this); } close() {} };
    </script>`;
    const html = BoardPage.render({ data }).replace(
      '<script type="application/json"',
      `${stub}<script type="application/json"`,
    );
    const raw = await BrowserPage.measure<string>({
      html,
      width: 1440,
      dark: false,
      expression: `(async () => {
        const dock = () => [...document.querySelectorAll('#dock [data-agent]')].map((c) => c.dataset.agent);
        const before = dock();
        window.__sources[0].onmessage({ data: JSON.stringify(${JSON.stringify(next)}) });
        await ${WAIT("dock()[0] === 'veni-forge'", 3000)};
        const helper = document.querySelector('#dock [data-agent="pnt-ignis-1"]').innerText;
        return JSON.stringify({ before, after: dock(), helper });
      })()`,
    });
    const seen: { before: string[]; after: string[]; helper: string } = JSON.parse(raw);

    expect(seen.before).toHaveLength(4);
    expect(seen.after).toEqual(['veni-forge', 'pnt-vulcan-1', 'pnt-ardor-1', 'pnt-ignis-1']);
    expect(seen.helper).toContain('under pnt-vulcan-1');
  });
});
