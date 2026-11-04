import { useEffect, useMemo, useRef, useState } from 'react';
import type { IBoardData } from '../common/index.ts';
import { Header, THEMES } from './components/header.tsx';
import type { TTheme } from './components/header.tsx';
import { Keys } from './components/keys.tsx';
import { SPLIT_DEFAULT, Split } from './components/split.tsx';
import { BoardLanguages } from './common/constants.ts';
import type { TBoardLanguage } from './common/types.ts';
import { useLive, useNow, useStored } from './hooks.ts';
import { TranslateContext } from './i18n/context.ts';
import { BoardI18n } from './i18n/translate.ts';
import { BoardStorage } from './storage.ts';
import { BoardView } from './state/view.ts';

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

export const App = (opts: { data: IBoardData }) => {
  const [data, setData] = useState(opts.data);
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
  const [tab, setTab] = useState<'Flows' | 'Agents'>('Flows');
  const [keysOpen, setKeysOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState(
    () => BoardStorage.get({ key: `${prefix}lastSeen` }) ?? new Date().toISOString(),
  );
  const [split, setSplit] = useState(
    () => Number(BoardStorage.get({ key: `${prefix}split` })) || SPLIT_DEFAULT,
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
  const flows = useMemo(
    () => BoardView.flowsOf({ data, showAll, lastSeen }),
    [data, showAll, lastSeen, now],
  );

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

  return (
    <TranslateContext.Provider value={translate}>
      <div className="app">
        <Header
          title={data.title}
          logo={data.logo}
          sources={data.sources}
          tab={tab}
          onTab={setTab}
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
          className={`view${tab === 'Flows' ? ' on' : ''}`}
          id="vFlows"
          role="tabpanel"
          aria-labelledby="tFlows"
          style={{ '--split': `${split}%` }}
        >
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
              setSplit(SPLIT_DEFAULT);
            }}
          />
        </div>
      </div>
      <Keys open={keysOpen} />
    </TranslateContext.Provider>
  );
};
