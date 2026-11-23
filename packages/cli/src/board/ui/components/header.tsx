import type { TLiveState } from '../hooks.ts';
import { useT } from '../i18n/context.ts';
import { BoardTime } from '../state/time.ts';
import { BoardUrl } from '../url.ts';
import { THEME_ICONS } from './icons.tsx';

export type TTheme = 'light' | 'dark' | 'system';
export const THEMES: TTheme[] = ['light', 'dark', 'system'];
const THEME_NAMES: Record<TTheme, string> = { light: 'sáng', dark: 'tối', system: 'theo máy' };

interface IHeaderProps {
  title: string;
  logo?: string;
  sources: string[];
  lastSeen: string;
  newCount: number;
  onSeen: () => void;
  showPlumbing: boolean;
  onPlumbing: () => void;
  language: 'en' | 'vi';
  onLanguage: () => void;
  theme: TTheme;
  onTheme: () => void;
  keysOpen: boolean;
  onKeys: () => void;
  live?: TLiveState;
}

export const Header = (props: IHeaderProps) => {
  const t = useT();
  const themeLabel = `${t('Giao diện: ')}${t(THEME_NAMES[props.theme])}`;
  const langLabel = `${t('lang.label')}: ${t(`lang.${props.language}`)}`;

  return (
    <header className="bar">
      <span className="mark" id="mark">
        {props.logo ? <img src={BoardUrl.safe({ value: props.logo, image: true })} alt="" /> : null}
      </span>
      <span className="brule" aria-hidden="true" />
      <h1 id="boardTitle">{props.title}</h1>
      {props.live === undefined ? null : (
        <span className={`fresh live-${props.live}`} id="fresh">
          <span className="fresh-dot" aria-hidden="true" />
          {t(`live.${props.live}`)}
        </span>
      )}
      <span className="spacer" />
      <span className="since" id="since" title={props.sources.join('\n')}>
        <span id="sinceTxt">
          {t('Từ lần xem trước lúc ')}
          <b>{BoardTime.clock({ iso: props.lastSeen })}</b>: <b>{props.newCount}</b>
          {t(' sự kiện mới')}
        </span>
        <button className="btn btn-text" type="button" id="bSeen" onClick={props.onSeen}>
          {t('Đánh dấu đã xem')}
        </button>
      </span>
      <span className="tools">
        <button
          className="btn"
          type="button"
          id="bPlumb"
          aria-pressed={props.showPlumbing}
          title={t('pl.tip')}
          onClick={props.onPlumbing}
        >
          {t('pl.all')}
        </button>
        <button
          className="btn sq lang"
          type="button"
          id="bLang"
          aria-label={langLabel}
          title={langLabel}
          onClick={props.onLanguage}
        >
          {props.language === 'en' ? 'VI' : 'EN'}
        </button>
        <button
          className="btn sq theme"
          type="button"
          id="bTheme"
          aria-label={`${themeLabel}${t('. Bấm để đổi')}`}
          title={themeLabel}
          onClick={props.onTheme}
        >
          {THEME_ICONS[props.theme]}
        </button>
        <button
          className="btn sq"
          type="button"
          id="bKeys"
          aria-label={t('Phím tắt')}
          aria-expanded={props.keysOpen}
          onClick={props.onKeys}
        >
          ?
        </button>
      </span>
    </header>
  );
};
