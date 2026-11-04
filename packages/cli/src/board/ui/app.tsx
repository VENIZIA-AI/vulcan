import { useEffect, useMemo, useState } from 'react';
import type { IBoardData } from '../common/index.ts';
import { BoardLanguages, BoardTables } from './common/constants.ts';
import type { TBoardLanguage } from './common/types.ts';
import { AgentPane } from './components/agents.tsx';
import { Detail } from './components/detail.tsx';
import type { TDetail } from './components/detail.tsx';
import { Header, THEMES } from './components/header.tsx';
import type { TTheme } from './components/header.tsx';
import { ItemPane } from './components/items.tsx';
import { Keys } from './components/keys.tsx';
import { useLive, useNow, useStored } from './hooks.ts';
import { UiContext } from './i18n/context.ts';
import { BoardI18n } from './i18n/translate.ts';
import { BoardCards } from './state/cards.ts';
import { BoardView } from './state/view.ts';
import { BoardStorage } from './storage.ts';

/** What a snapshot of `vulcan board serve` replaces; the title, owner, key and logo stay as the page loaded them. */
const SNAPSHOT_KEYS = [
  'flows',
  'decisions',
  'agents',
  'shapes',
  'roster',
  'lanes',
  'roles',
  'sources',
  'generatedAt',
  'since',
] as const;
const TYPING = 'input,textarea,select,[contenteditable="true"]';

export const App = (props: { data: IBoardData }) => {
  const [data, setData] = useState(props.data);
  const prefix = `board:${data.key}:`;
  const [language, setLanguage] = useStored<TBoardLanguage>({
    key: `${prefix}lang`,
    initial: BoardLanguages.EN,
    allowed: [BoardLanguages.EN, BoardLanguages.VI],
  });
  const [theme, setTheme] = useStored<TTheme>({
    key: `${prefix}theme`,
    initial: 'light',
    allowed: THEMES,
  });
  const [plumbing, setPlumbing] = useStored<'0' | '1'>({
    key: `${prefix}plumbing`,
    initial: '0',
    allowed: ['0', '1'],
  });
  const [keysOpen, setKeysOpen] = useState(false);
  const [detail, setDetail] = useState<TDetail | null>(null);
  const [everything, setEverything] = useState(false);
  const [agent, setAgent] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [lastSeen, setLastSeen] = useState(
    () => BoardStorage.get({ key: `${prefix}lastSeen` }) ?? new Date().toISOString(),
  );
  const now = useNow();
  const showAll = plumbing === '1';
  const live = useLive({
    data,
    onData: (next) =>
      setData((was) => ({
        ...was,
        ...Object.fromEntries(SNAPSHOT_KEYS.map((key) => [key, next[key]])),
      })),
  });
  const translate = useMemo(
    () => (key: string) => BoardI18n.translate({ language, key }),
    [language],
  );
  const ui = useMemo(() => ({ t: translate, now }), [translate, now]);
  const events = useMemo(() => BoardView.eventsOf({ data, showAll }), [data, showAll]);
  const flows = useMemo(
    () => BoardView.flowsOf({ data, showAll, lastSeen }),
    [data, showAll, lastSeen, now],
  );
  const rows = useMemo(
    () => BoardView.rowsOf({ data, flows, events, translate, now }),
    [data, flows, events, translate, now],
  );
  const cards = useMemo(
    () =>
      Object.fromEntries(
        rows.map((row) => [
          row.n,
          BoardCards.agentOf({ data, events, views: flows, row, doc: data.agents[row.n], now }),
        ]),
      ),
    [data, events, flows, rows, now],
  );
  const shown =
    detail !== null &&
    (detail.kind === 'flow'
      ? flows.some((view) => view.flow.id === detail.id)
      : rows.some((row) => row.n === detail.name));
  const selectFlow = (id: string): void => setDetail({ kind: 'flow', id });
  const pickAgent = (name: string): void => {
    if (agent === name) {
      setAgent(null);
      setDetail(null);

      return;
    }

    setAgent(name);
    setDetail({ kind: 'agent', name });
  };

  useEffect(() => {
    document.title = data.title;
    document.documentElement.lang = language;
  }, [data.title, language]);

  useEffect(() => {
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-board-theme');
    } else {
      document.documentElement.setAttribute('data-board-theme', theme);
    }
  }, [theme]);

  useEffect(() => {
    BoardStorage.set({ key: `${prefix}lastSeen`, value: lastSeen });
  }, [prefix, lastSeen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target instanceof Element ? event.target : null;

      if (target?.closest?.(TYPING) || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const cardsOnPage = [...document.querySelectorAll<HTMLElement>('.row')];
      const selected = detail?.kind === 'flow' ? detail.id : null;
      const at = cardsOnPage.findIndex((card) => card.dataset.id === selected);

      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault();

        const next =
          event.key === 'j' ? Math.min(cardsOnPage.length - 1, at + 1) : Math.max(0, at - 1);
        const id = cardsOnPage[next]?.dataset.id;

        if (id !== undefined) {
          selectFlow(id);
          cardsOnPage[next].focus();
        }
      } else if (event.key === 'e' && selected) {
        setEverything(!everything);
      } else if (event.key === 'Escape') {
        if (keysOpen) {
          setKeysOpen(false);
        } else {
          setDetail(null);
        }
      } else if (event.key === '?') {
        setKeysOpen(!keysOpen);
      }
    };

    document.addEventListener('keydown', onKey);

    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <UiContext.Provider value={ui}>
      <div className="app">
        <Header
          title={data.title}
          logo={data.logo}
          sources={data.sources}
          lastSeen={lastSeen}
          newCount={flows.reduce((sum, view) => sum + view.newCount, 0)}
          onSeen={() => setLastSeen(new Date().toISOString())}
          showPlumbing={showAll}
          onPlumbing={() => setPlumbing(showAll ? '0' : '1')}
          language={language}
          onLanguage={() =>
            setLanguage(language === BoardLanguages.EN ? BoardLanguages.VI : BoardLanguages.EN)
          }
          theme={theme}
          onTheme={() => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length])}
          keysOpen={keysOpen}
          onKeys={() => setKeysOpen(!keysOpen)}
          live={data.live === undefined ? undefined : live}
        />
        <main className={`c-main${shown ? '' : ' closed'}`} id="vFlows">
          <AgentPane
            rows={rows}
            cards={cards}
            owner={data.owner}
            shapes={data.shapes}
            picked={agent}
            onPick={pickAgent}
          />
          <ItemPane
            views={flows}
            agent={agent}
            onAgent={(name) => {
              setAgent(name);

              if (name === null && detail?.kind === 'agent') {
                setDetail(null);
              }
            }}
            selected={detail?.kind === 'flow' ? detail.id : null}
            onSelect={selectFlow}
            open={open}
            onToggle={(key) =>
              setOpen((was) => ({
                ...was,
                [key]: !(was[key] ?? BoardTables.GROUPS.find((group) => group.key === key)?.open),
              }))
            }
          />
          <Detail
            detail={shown ? detail : null}
            views={flows}
            rows={rows}
            cards={cards}
            data={data}
            events={events}
            everything={everything}
            onEverything={setEverything}
            onFlow={selectFlow}
            onClose={() => setDetail(null)}
          />
        </main>
      </div>
      <Keys open={keysOpen} />
    </UiContext.Provider>
  );
};
