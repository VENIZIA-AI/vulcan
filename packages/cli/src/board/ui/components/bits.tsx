import type { ReactNode } from 'react';
import type { IBoardItem } from '../../common/index.ts';
import { BoardTables } from '../common/constants.ts';
import type { IBoardViewEvent } from '../common/types.ts';
import { useUi } from '../i18n/context.ts';
import { BoardTime } from '../state/time.ts';
import { BoardUrl } from '../url.ts';

const isBad = (event: { status?: string }): boolean =>
  event.status === 'fail' || event.status === 'blocked';

/** A tick or a cross: a check passed or failed. */
export const Mark = (props: { bad: boolean }) => {
  const { t } = useUi();

  return (
    <svg
      className={`mk ${props.bad ? 'x' : 'v'}`}
      viewBox="0 0 10 10"
      role="img"
      aria-label={props.bad ? t('lỗi') : t('đạt')}
    >
      <path
        d={props.bad ? 'M2.5 2.5l5 5M7.5 2.5l-5 5' : 'M2 5.4l2 2 4-4.8'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

/** How far along: a thin bar filled by `done` of `total`. */
export const Bar = (props: { done: number; total: number }) => (
  <span className="c-bar">
    <span style={{ width: `${Math.round((props.done / props.total) * 100)}%` }} />
  </span>
);

/** A list of a flow line as a checklist; the checked ones are done. Nothing when the line gave none. */
export const Checklist = (props: { items: IBoardItem[] | undefined }) => {
  const { items } = props;

  if (items === undefined || items.length === 0) {
    return null;
  }

  return (
    <div className="ckl">
      <ul>
        {items.map((item, index) => (
          <li key={`${index}:${item.text}`} className={item.done ? 'on' : undefined}>
            {item.text}
          </li>
        ))}
      </ul>
    </div>
  );
};

/** Who a line came from (a message the actor got) or went to. */
const Route = (props: { event: IBoardViewEvent }) => {
  const { event } = props;

  if (event.incoming) {
    return event.from ? (
      <>
        {' ← '}
        <b>{event.from}</b>
      </>
    ) : null;
  }

  return event.to ? (
    <>
      {' → '}
      <b>{event.to}</b>
    </>
  ) : null;
};

/** One line of a flow: when, who to whom, what, and where it came from when that changes how to read it. */
export const EventItem = (props: { event: IBoardViewEvent; chip?: ReactNode }) => {
  const { t } = useUi();
  const { event } = props;
  const approx = BoardTime.isApproximate({ source: event.source });
  const link = BoardUrl.safe({ value: event.link });
  const kind = BoardTables.KIND_TEXT[event.kind];
  let origin = '';

  if (approx) {
    origin = t('giờ ước lượng');
  } else if (event.source === 'github') {
    origin = 'GitHub';
  }

  return (
    <li className={`ev${isBad(event) ? ' fail' : ''}`}>
      <span className="tm">
        {approx ? '≈' : ''}
        {BoardTime.clock({ iso: event.ts })}
      </span>
      <div>
        {props.chip}
        <div className="who">
          <b>{event.actor}</b>
          <Route event={event} />
          {` · ${kind ? t(kind) : event.kind}${event.attempt && event.attempt > 1 ? `${t(' lần ')}${event.attempt}` : ''}`}
        </div>
        <div className="sm">{event.summary}</div>
        {link || origin ? (
          <div>
            {link ? (
              <a
                className="lk"
                href={BoardUrl.safe({ value: event.link })}
                target="_blank"
                rel="noopener"
              >
                {link.replace(/^https:\/\/github\.com\//, '')}
              </a>
            ) : null}
            {link && origin ? ' · ' : null}
            {origin ? <span className="src">{origin}</span> : null}
          </div>
        ) : null}
      </div>
    </li>
  );
};
