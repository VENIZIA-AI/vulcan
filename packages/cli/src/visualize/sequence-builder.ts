import { KindFigureConstants } from './constants.ts';
import type { IKindDrawing } from './common/index.ts';
import type { TChrome } from './constants.ts';
import { FigureLayout } from './layout.ts';
import { MessageKinds } from './kinds-schema.ts';
import type { TSequence } from './kinds-schema.ts';
import { KindFigureUtility } from './utilities/kind-figure.utility.ts';

// -----------------------------------------------------------------------------------------------------------------
// Sequence
// -----------------------------------------------------------------------------------------------------------------

const MESSAGE_WORD: Record<string, keyof typeof KindFigureConstants.WORDS> = {
  call: 'kindCall',
  reply: 'kindReply',
  async: 'kindAsync',
};

/** The figure of a sequence: who sends what to whom, in order. */
export class SequenceBuilder {
  static build(opts: { sequence: TSequence; chrome: TChrome }): IKindDrawing {
    const { sequence, chrome } = opts;
    const count = sequence.participants.length;
    const lane = Math.max(190, Math.floor(600 / count));
    const width = KindFigureConstants.MARGIN * 2 + count * lane;
    const boxWidth = lane - 24;
    const centre = (index: number): number => KindFigureConstants.MARGIN + lane * index + lane / 2;
    const positions = new Map(sequence.participants.map((part, index) => [part.id, index]));
    const heads = sequence.participants.map((part) => {
      const labelLines = KindFigureUtility.wrapLines({
        text: part.label,
        chars: Math.floor((boxWidth - 20) / KindFigureConstants.LABEL_PX),
      });
      const subLines =
        part.sublabel === undefined
          ? []
          : KindFigureUtility.wrapLines({
              text: part.sublabel,
              chars: Math.floor((boxWidth - 20) / KindFigureConstants.SMALL_PX),
            });
      const last = 24 + (labelLines.length - 1) * 17;
      const bottom = subLines.length === 0 ? last : last + 17 + (subLines.length - 1) * 15;

      return { part, labelLines, subLines, last, height: bottom + 14 };
    });
    const headHeight = Math.max(...heads.map((item) => item.height));
    const hasNote = sequence.messages.some((message) => message.note !== undefined);
    const rowHeight = hasNote ? 66 : 52;
    const firstY = 8 + headHeight + (hasNote ? 48 : 40);
    const lastY = firstY + (sequence.messages.length - 1) * rowHeight;
    const kinds = [
      ...new Set(sequence.messages.map((message) => message.type ?? MessageKinds.CALL)),
    ];
    const legendHeight = kinds.length > 1 ? 34 : 0;
    const height = lastY + (hasNote ? 40 : 28) + legendHeight;
    const lifelines = heads
      .map(
        (_, index) =>
          `<path class="klife" d="M${centre(index)} ${8 + headHeight}V${height - legendHeight - 8}"/>`,
      )
      .join('');
    const boxes = heads
      .map((item, index) => {
        const x = centre(index) - boxWidth / 2;

        return `<g><rect class="kbox" x="${x}" y="8" width="${boxWidth}" height="${headHeight}" rx="4"/>${KindFigureUtility.textLines({ cls: 'kt', x: centre(index), y: 8 + 24, lines: item.labelLines, step: 17, anchor: 'middle' })}${item.subLines.length === 0 ? '' : KindFigureUtility.textLines({ cls: 'ks', x: centre(index), y: 8 + item.last + 17, lines: item.subLines, step: 15, anchor: 'middle' })}</g>`;
      })
      .join('');
    const messages = sequence.messages
      .map((message, order) => {
        const from = positions.get(message.from);
        const to = positions.get(message.to);

        if (from === undefined || to === undefined || from === to) {
          return '';
        }

        const kind = message.type ?? MessageKinds.CALL;
        const sign = to > from ? 1 : -1;
        const y = firstY + order * rowHeight;
        const x1 = centre(from) + sign * 6;
        const x2 = centre(to) - sign * 6;

        return `<g class="kmsg k-${kind}">${message.note === undefined ? '' : `<title>${FigureLayout.escapeText({ value: message.note })}</title>`}<path class="kline${kind === MessageKinds.REPLY ? ' kdash' : ''}" d="M${x1} ${y}H${x2}"/>${KindFigureUtility.head({ x: x2, y, dx: sign, dy: 0, open: kind === MessageKinds.ASYNC })}<text class="ke kh" x="${(x1 + x2) / 2}" y="${y - 9}" text-anchor="middle"><tspan class="knum">${order + 1}.</tspan> ${FigureLayout.escapeText({ value: message.label })}</text>${message.note === undefined ? '' : `<text class="ks kh" x="${(x1 + x2) / 2}" y="${y + 18}" text-anchor="middle">${FigureLayout.escapeText({ value: message.note })}</text>`}</g>`;
      })
      .join('');
    const legend =
      kinds.length > 1
        ? kinds
            .map((kind, index) => {
              const x = KindFigureConstants.MARGIN + index * 150;
              const y = height - 18;

              return `<g class="klegend"><path class="kline${kind === MessageKinds.REPLY ? ' kdash' : ''}" d="M${x} ${y}H${x + 34}"/>${KindFigureUtility.head({ x: x + 34, y, dx: 1, dy: 0, open: kind === MessageKinds.ASYNC })}<text class="ks" x="${x + 46}" y="${y + 4}">${FigureLayout.escapeText({ value: KindFigureUtility.wordOf({ chrome, key: MESSAGE_WORD[kind] ?? 'kindCall' }) })}</text></g>`;
            })
            .join('')
        : '';
    const names = sequence.participants.map((part) => part.label).join(', ');
    const nameOf = (id: string): string =>
      sequence.participants.find((part) => part.id === id)?.label ?? id;

    return {
      svg: KindFigureUtility.svgOf({
        width,
        height,
        label: `${chrome.sequence}: ${names}`,
        body: `${lifelines}${boxes}${messages}${legend}`,
      }),
      width,
      list: `<div class="path kl ksq"><ul class="kparts">${sequence.participants.map((part) => `<li><b>${FigureLayout.escapeText({ value: part.label })}</b>${part.sublabel === undefined ? '' : ` <span class="mut">${FigureLayout.escapeText({ value: part.sublabel })}</span>`}</li>`).join('')}</ul><ol class="kmsgs">${sequence.messages
        .map((message) => {
          const kind = message.type ?? MessageKinds.CALL;

          return `<li class="k-${kind}"><b>${FigureLayout.escapeText({ value: nameOf(message.from) })}</b><span class="verb kv-${kind}">${FigureLayout.escapeText({ value: message.label })}</span><b>${FigureLayout.escapeText({ value: nameOf(message.to) })}</b>${kind === MessageKinds.CALL ? '' : ` <span class="kword">${FigureLayout.escapeText({ value: KindFigureUtility.wordOf({ chrome, key: MESSAGE_WORD[kind] ?? 'kindCall' }) })}</span>`}${message.note === undefined ? '' : `<span class="knote">${FigureLayout.escapeText({ value: message.note })}</span>`}</li>`;
        })
        .join('')}</ol></div>`,
      caption:
        sequence.caption ??
        `${names}: ${sequence.messages.length} ${KindFigureUtility.wordOf({ chrome, key: 'countMessages' })}`,
      label: `${chrome.sequence}: ${names}`,
    };
  }
}
