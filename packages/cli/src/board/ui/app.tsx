import { useEffect, useMemo, useRef, useState } from 'react';
import type { IBoardData } from '../common/index.ts';
import { BoardLanguages, BoardTables } from './common/constants.ts';
import type { TBoardLanguage } from './common/types.ts';
import { Detail } from './components/detail.tsx';
import { FlowDiagram } from './components/diagram.tsx';
import { Dock } from './components/dock.tsx';
import { BoardFace } from './components/face.tsx';
import { Header, THEMES } from './components/header.tsx';
import type { TTheme } from './components/header.tsx';
import { Keys } from './components/keys.tsx';
import { FlowList, VIEW_MODES } from './components/list.tsx';
import type { TViewMode } from './components/list.tsx';
import { AgentPop } from './components/pop.tsx';
import { BoardSplit, Split } from './components/split.tsx';
import { useLive, useNow, useStored } from './hooks.ts';
import { UiContext } from './i18n/context.ts';
import { BoardI18n } from './i18n/translate.ts';
import { BoardAgentInfo } from './state/agent-info.ts';
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
  const [mode, setMode] = useStored<TViewMode>({
    key: `${prefix}view`,
    initial: 'list',
    allowed: VIEW_MODES,
  });
  const [keysOpen, setKeysOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [everything, setEverything] = useState(false);
  const [agent, setAgent] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const [pop, setPop] = useState<{ name: string; anchor: HTMLElement } | null>(null);
  const [lastSeen, setLastSeen] = useState(
    () => BoardStorage.get({ key: `${prefix}lastSeen` }) ?? new Date().toISOString(),
  );
  const [split, setSplit] = useState(() =>
    BoardSplit.clamp({
      percent: Number(BoardStorage.get({ key: `${prefix}split` })) || BoardSplit.DEFAULT,
    }),
  );
  const area = useRef<HTMLDivElement>(null);
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
    () =>
      BoardView.rowsOf({
        data,
        flows,
        events,
        docs: BoardView.docsOf({ data }),
        showAll,
        translate,
      }),
    [data, flows, events, showAll, translate],
  );
  const popRow = pop && rows.find((row) => row.n === pop.name);
  const shapeOf = (name: string): string =>
    BoardFace.shapeOf({ name, owner: data.owner, shapes: data.shapes });

  const select = (opts: { id: string; open?: boolean }): void => {
    setSelected(opts.id);
    setDetailOpen(opts.open ?? true);
  };
  const closePop = (): void => {
    if (pop?.anchor.isConnected) {
      pop.anchor.focus();
    }

    setPop(null);
  };
  const openPop = (opts: { name: string; anchor: HTMLElement }): void => {
    setPop(pop?.name === opts.name ? null : opts);
  };
  const toFlow = (id: string): void => {
    setPop(null);
    select({ id });
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

      if (event.key === 'Escape' && pop) {
        event.preventDefault();
        closePop();

        return;
      }

      if (target?.closest?.(TYPING) || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const cards = [...document.querySelectorAll<HTMLElement>('.row,.kcard')];
      const at = cards.findIndex((card) => card.dataset.id === selected);

      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault();

        const next = event.key === 'j' ? Math.min(cards.length - 1, at + 1) : Math.max(0, at - 1);

        if (cards.length > 0 && cards[next].dataset.id) {
          select({ id: cards[next].dataset.id, open: false });
          cards[next].focus();
        }
      } else if (event.key === 'Enter' && selected && !target?.closest?.('button,a,.row')) {
        event.preventDefault();
        select({ id: selected });
      } else if (event.key === 'e' && selected) {
        setEverything(!everything);
      } else if (event.key === 'Escape') {
        if (keysOpen) {
          setKeysOpen(false);
        } else {
          setDetailOpen(false);
          document
            .querySelector<HTMLElement>(`.row[data-id="${CSS.escape(selected ?? '')}"]`)
            ?.focus();
        }
      } else if (event.key === '?') {
        setKeysOpen(!keysOpen);
      }
    };
    const onPointer = (event: PointerEvent): void => {
      const target = event.target instanceof Element ? event.target : null;

      if (pop && !target?.closest?.('#pop,.cell')) {
        setPop(null);
      }
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
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
        <div
          ref={area}
          className="view on"
          id="vFlows"
          role="tabpanel"
          aria-labelledby="tFlows"
          style={{ '--split': `${split}%` }}
        >
          <FlowList
            flows={flows}
            mode={mode}
            onMode={(next) => {
              setMode(next);

              const first = ['you', 'blocked', 'running']
                .map((state) => flows.find((view) => view.flow.state === state))
                .find(Boolean);

              if (next === 'diagram' && selected === null && (first ?? flows[0])) {
                select({ id: (first ?? flows[0]).flow.id });
              }
            }}
            selected={selected}
            onSelect={(id) => select({ id })}
            agent={agent}
            onAgent={setAgent}
            open={open}
            onToggle={(key) =>
              setOpen((was) => ({
                ...was,
                [key]: !(was[key] ?? BoardTables.GROUPS.find((group) => group.key === key)?.open),
              }))
            }
          />
          <Split
            percent={split}
            area={() => area.current}
            onChange={(percent, save) => {
              setSplit(percent);

              if (save) {
                BoardStorage.set({ key: `${prefix}split`, value: String(percent) });
              }
            }}
            onReset={() => {
              BoardStorage.remove({ key: `${prefix}split` });
              setSplit(BoardSplit.DEFAULT);
            }}
          />
          <Detail
            views={flows}
            events={events}
            selected={selected}
            open={detailOpen}
            diagramMode={mode === 'diagram'}
            diagram={(view) => <FlowDiagram view={view} owner={data.owner} />}
            everything={everything}
            onEverything={setEverything}
            attempts={attempts}
            onAttempt={(key, round) => setAttempts((was) => ({ ...was, [key]: round }))}
            onSelect={(id) => select({ id })}
            onClose={() => setDetailOpen(false)}
          />
        </div>
        <Dock
          rows={rows}
          owner={data.owner}
          shapes={data.shapes}
          popFor={pop?.name ?? null}
          onOpen={openPop}
        />
      </div>
      {pop && popRow ? (
        <AgentPop
          row={popRow}
          anchor={pop.anchor}
          shape={shapeOf(pop.name)}
          views={flows}
          info={BoardAgentInfo.of({ data, events, name: pop.name })}
          data={data}
          filtered={agent === pop.name}
          onFilter={() => {
            setAgent(agent === pop.name ? null : pop.name);
            setPop(null);
          }}
          onFlow={toFlow}
          onClose={closePop}
        />
      ) : null}
      <Keys open={keysOpen} />
    </UiContext.Provider>
  );
};
