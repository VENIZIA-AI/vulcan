import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BoardStateWords } from '../common/constants.ts';
import type { IAgentRow, IBoardViewEvent, IFlowView } from '../common/types.ts';
import { useUi } from '../i18n/context.ts';
import { BoardAgentInfo } from '../state/agent-info.ts';
import type { IOpenPr } from '../state/agent-info.ts';
import { BoardTime } from '../state/time.ts';
import { BoardUrl } from '../url.ts';
import { Mark } from './bits.tsx';
import { BoardFace, Face } from './face.tsx';

const MARGIN = 16;
const GAP = 8;
const TOP_MIN = 12;

interface IPopProps {
  row: IAgentRow;
  anchor: Element;
  shape: string;
  views: IFlowView[];
  info: { mine: IBoardViewEvent[]; open: IOpenPr[]; pending: IBoardViewEvent[] };
  data: Parameters<typeof BoardAgentInfo.endsOf>[0]['data'];
  filtered: boolean;
  onFilter: () => void;
  onFlow: (id: string) => void;
  onClose: () => void;
}

const Section = (props: { title: string; empty: string; children: React.ReactNode[] }) => (
  <>
    <h3>{props.title}</h3>
    {props.children.length === 0 ? <p className="none">{props.empty}</p> : props.children}
  </>
);

/** The card of one agent, above or below the cell it was opened from (a sheet on a narrow screen). */
export const AgentPop = (props: IPopProps) => {
  const { t, now } = useUi();
  const { row, info } = props;
  const box = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const place = (): void => {
    const element = box.current;

    if (element === null || matchMedia('(max-width:640px)').matches) {
      setAt(null);

      return;
    }

    const anchor = props.anchor.getBoundingClientRect();
    const left = Math.max(
      MARGIN,
      Math.min(
        innerWidth - element.offsetWidth - MARGIN,
        anchor.left + anchor.width / 2 - element.offsetWidth / 2,
      ),
    );
    const above = anchor.top - element.offsetHeight - GAP;

    setAt({
      left,
      top: Math.max(
        TOP_MIN,
        above >= TOP_MIN
          ? above
          : Math.min(innerHeight - element.offsetHeight - TOP_MIN, anchor.bottom + GAP),
      ),
    });
  };

  useLayoutEffect(place, [props.anchor, row.key]);
  useEffect(() => {
    addEventListener('resize', place);
    setOn(true);
    box.current?.querySelector('button')?.focus({ preventScroll: true });

    return () => removeEventListener('resize', place);
  }, []);

  const href = BoardAgentInfo.prHref({
    pr: info.open[0] ?? { n: 0, flow: '', ci: null, link: null },
  });
  const titleOf = (id: string): string =>
    props.views.find((view) => view.flow.id === id)?.flow.title ?? '';

  return (
    <div
      ref={box}
      className={`pop${on ? ' on' : ''}`}
      id="pop"
      role="dialog"
      aria-modal="false"
      aria-labelledby="popName"
      style={at === null ? undefined : { left: `${at.left}px`, top: `${at.top}px`, bottom: 'auto' }}
    >
      <div className="phd">
        <Face
          state={row.st}
          tint={BoardFace.tintOf({ name: row.n })}
          name={row.n}
          shape={props.shape}
        />
        <div>
          <h2 id="popName">{row.n}</h2>
          <div className="sub">
            <span className={`spill ${row.st}`}>{t(BoardStateWords.PILL[row.st])}</span>
            {row.ts ? (
              <span>{`${t('từ ')}${BoardTime.clock({ iso: row.ts })} · ${row.approx ? '≈ ' : ''}${BoardTime.ago({ iso: row.ts, now, translate: t })}`}</span>
            ) : null}
          </div>
        </div>
        <button className="btn sq" type="button" aria-label={t('Đóng')} onClick={props.onClose}>
          ×
        </button>
      </div>
      <div className="pbd">
        <div className="now">
          {row.flow ? (
            <button
              className="btn chip"
              type="button"
              style={{ margin: 0 }}
              title={titleOf(row.flow)}
              onClick={() => props.onFlow(row.flow ?? '')}
            >
              {row.flow}
            </button>
          ) : null}
          <span className="tx">{row.text || t('chưa có việc')}</span>
        </div>
        <Section title={t('5 sự kiện gần nhất')} empty={t('Chưa có sự kiện nào của agent này.')}>
          {info.mine.length === 0
            ? []
            : [
                <ul key="mine" className="pevs">
                  {info.mine
                    .slice(-5)
                    .reverse()
                    .map((event) => (
                      <li key={event.id}>
                        <span className="tm">
                          {BoardTime.isApproximate({ source: event.source }) ? '≈' : ''}
                          {BoardTime.clock({ iso: event.ts })}
                        </span>
                        <span className="sm">
                          {event.flowId ? <span className="fl">{event.flowId}</span> : null}
                          {event.summary}
                        </span>
                      </li>
                    ))}
                </ul>,
              ]}
        </Section>
        <Section
          title={`${t('PR đang mở (')}${info.open.length})`}
          empty={t('Không có PR nào đang mở.')}
        >
          {info.open.length === 0
            ? []
            : [
                <ul key="prs" className="prs">
                  {info.open.map((pr) => (
                    <li key={`${pr.repo}#${pr.n}`}>
                      <a
                        href={BoardUrl.safe({ value: BoardAgentInfo.prHref({ pr }) })}
                        target="_blank"
                        rel="noopener"
                      >
                        <span className="code">{`${pr.repo ?? ''}#${pr.n}`}</span>
                        {pr.ci ? <Mark bad={pr.ci === 'fail'} /> : null}
                        <span>{pr.flow}</span>
                      </a>
                    </li>
                  ))}
                </ul>,
              ]}
        </Section>
        <Section
          title={`${t('Tin nhắn chưa có trả lời (')}${info.pending.length})`}
          empty={t('Không có tin nào đang chờ.')}
        >
          {info.pending.length === 0
            ? []
            : [
                <ul key="pending" className="pevs">
                  {info.pending
                    .slice(-5)
                    .reverse()
                    .map((message) => {
                      const { sender, receiver } = BoardAgentInfo.endsOf({
                        data: props.data,
                        message,
                      });

                      return (
                        <li key={message.id}>
                          <span className="tm">
                            {BoardTime.isApproximate({ source: message.source }) ? '≈' : ''}
                            {BoardTime.clock({ iso: message.ts })}
                          </span>
                          <span className="sm">{`${sender === row.n ? `→ ${receiver ?? '?'}` : `← ${sender ?? '?'}`}: ${message.summary}`}</span>
                        </li>
                      );
                    })}
                </ul>,
              ]}
        </Section>
      </div>
      <div className="pft">
        <div className="row2">
          <button className="btn" type="button" onClick={props.onFilter}>
            {props.filtered ? t('Bỏ lọc luồng') : t('Lọc luồng')}
          </button>
          {href ? (
            <a className="btn" href={BoardUrl.safe({ value: href })} target="_blank" rel="noopener">
              {t('Mở trên GitHub')}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
};
