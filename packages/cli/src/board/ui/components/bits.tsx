import type { ReactNode } from 'react';
import type { IBoardItem } from '../../common/index.ts';
import { BoardTables } from '../common/constants.ts';
import type { IBoardViewEvent, IFlowView } from '../common/types.ts';
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

export const FlowCode = (props: { id: string }) => (
  <span className="code">{props.id === 'Unsorted' ? '-' : props.id}</span>
);

export const Untitled = () => <span className="untitled">{useUi().t('fl.untitled')}</span>;

/** A list of a flow line as a checklist with its count: `Steps · 2/3`. Nothing when the line gave none. */
export const Checklist = (props: { title: string; items: IBoardItem[] | undefined }) => {
  const { items } = props;

  if (items === undefined || items.length === 0) {
    return null;
  }

  return (
    <div className="ckl">
      <div className="lb">{`${props.title} · ${items.filter((item) => item.done).length}/${items.length}`}</div>
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

/** The stages of a flow, the one it is at marked, with the CI runs and reviews of each. */
export const Strip = (props: { view: IFlowView }) => {
  const { t } = useUi();
  const { view } = props;

  if (view.noWork) {
    return (
      <div className="strip">
        <span className="sg">{t('nw.chip')}</span>
      </div>
    );
  }

  return (
    <div className="strip">
      {view.flow.stages.map((k) => {
        const here = view.att[k] ?? [];
        const ci = here.filter((event) => event.kind === 'ci' || event.kind === 'release');
        const reviews = here.filter((event) => event.kind === 'review');
        const name = t(BoardTables.STAGES[k]);
        const cur = k === view.flow.cur;
        const classes = ['sg'];
        const titles = [name];

        if (k < view.flow.cur) {
          classes.push('past');
        }

        if (cur) {
          classes.push('cur');
        }

        if (cur && (view.flow.state === 'you' || view.flow.state === 'blocked')) {
          classes.push(view.flow.state);
        }

        if (ci.length > 0) {
          titles.push(
            `CI ${ci.map((event) => (event.status === 'fail' ? t('đỏ') : 'xanh')).join(', ')}`,
          );
        }

        if (reviews.length > 0) {
          titles.push(`${reviews.length}${t(' vòng review')}`);
        }

        return (
          <span key={k} className={classes.join(' ')} title={titles.join(' · ')}>
            {name}
            {ci.slice(-4).map((event) => (
              <Mark key={event.id} bad={event.status === 'fail'} />
            ))}
            {reviews.length > 1 ? <span>×{reviews.length}</span> : null}
            {reviews.length === 1 && reviews[0].status === 'fail' ? <Mark bad /> : null}
          </span>
        );
      })}
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
      <b>{event.asTo ?? event.to}</b>
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
          <b>{event.as ?? event.actor}</b>
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
