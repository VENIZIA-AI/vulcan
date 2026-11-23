import { useState } from 'react';
import type { TLiveState } from '../hooks.ts';
import { useT } from '../i18n/context.ts';
import { BoardTime } from '../state/time.ts';
import { BoardUrl } from '../url.ts';
import { ICONS, THEME_ICONS } from './icons.tsx';

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
  const clock = BoardTime.clock({ iso: props.lastSeen });
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={`bar${menuOpen ? ' menu-open' : ''}`}>
      <span className="mark" id="mark">
        {props.logo ? <img src={BoardUrl.safe({ value: props.logo, image: true })} alt="" /> : null}
      </span>
      <span className="brule" aria-hidden="true" />
      <h1 id="boardTitle">{props.title}</h1>
      {props.live === undefined ? null : (
        <span className={`fresh live-${props.live}`} id="fresh">
          <span className="fresh-dot" aria-hidden="true" />
          <span className="fresh-text">{t(`live.${props.live}`)}</span>
        </span>
      )}
      <span className="spacer" />
      <button
        className={`since${props.newCount > 0 ? ' has-new' : ''}`}
        type="button"
        id="bSeen"
        title={`${t('Từ lần xem trước lúc ')}${clock}: ${props.newCount}${t(' sự kiện mới')}\n${props.sources.join('\n')}`}
        aria-label={`${props.newCount} ${t('hd.new')} ${clock}. ${t('Đánh dấu đã xem')}`}
        onClick={props.onSeen}
      >
        <span className="since-dot" aria-hidden="true" />
        <b className="num">{props.newCount}</b> {t('hd.new')} <span className="num">{clock}</span>
      </button>
      <button
        className="ib more"
        type="button"
        aria-label={t('hd.more')}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(!menuOpen)}
      >
        {ICONS.more}
      </button>
      <span className="tools">
        <button
          className="ib"
          type="button"
          id="bPlumb"
          aria-pressed={props.showPlumbing}
          title={t('pl.tip')}
          onClick={props.onPlumbing}
        >
          {ICONS.eye}
          <span className="lbl">{t('pl.all')}</span>
        </button>
        <button
          className="ib lang"
          type="button"
          id="bLang"
          aria-label={langLabel}
          title={langLabel}
          onClick={props.onLanguage}
        >
          {props.language === 'en' ? 'VI' : 'EN'}
          <span className="lbl" aria-hidden="true">
            {t(`lang.${props.language === 'en' ? 'vi' : 'en'}`)}
          </span>
        </button>
        <button
          className="ib theme"
          type="button"
          id="bTheme"
          aria-label={`${themeLabel}${t('. Bấm để đổi')}`}
          title={themeLabel}
          onClick={props.onTheme}
        >
          {THEME_ICONS[props.theme]}
          <span className="lbl" aria-hidden="true">
            {themeLabel}
          </span>
        </button>
        <button
          className="ib"
          type="button"
          id="bKeys"
          aria-label={t('Phím tắt')}
          aria-expanded={props.keysOpen}
          onClick={props.onKeys}
        >
          ?
          <span className="lbl" aria-hidden="true">
            {t('Phím tắt')}
          </span>
        </button>
      </span>
    </header>
  );
};
