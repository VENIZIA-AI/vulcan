import { BoardConstants } from '../../common/index.ts';
import { BoardUiConstants } from '../common/constants.ts';
import type { TTranslate } from '../common/types.ts';

const MINUTE_MS = 60_000;

/** How the page says when. */
export class BoardTime {
  /** `09:05`, in the 24-hour form of Vietnamese; `--:--` for a time that is not one. */
  static clock(opts: { iso: string }): string {
    const date = new Date(opts.iso);

    return Number.isNaN(date.getTime())
      ? '--:--'
      : date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  /** How long before `now`: `just now`, minutes, hours and minutes, or days. */
  static ago(opts: { iso: string; now: number; translate: TTranslate }): string {
    const { translate } = opts;
    const minutes = Math.max(0, Math.round((opts.now - new Date(opts.iso).getTime()) / MINUTE_MS));

    if (minutes < 1) {
      return translate('vừa xong');
    }

    if (minutes < 60) {
      return `${minutes}${translate(' phút')}`;
    }

    const hours = Math.floor(minutes / 60);

    if (hours < 24) {
      return `${hours}${translate(' giờ')}${minutes % 60 ? ` ${minutes % 60}${translate(' phút')}` : ''}`;
    }

    return `${Math.floor(hours / 24)}${translate(' ngày')}`;
  }

  static isSameDay(opts: { iso: string; now: number }): boolean {
    return new Date(opts.iso).toDateString() === new Date(opts.now).toDateString();
  }

  /** Whether `iso` is within the last `days` days of `now`. */
  static isWithin(opts: { iso: string; now: number; days: number }): boolean {
    return opts.now - Date.parse(opts.iso) < opts.days * BoardConstants.DAY_MS;
  }

  /** Whether the line says its own time was estimated. */
  static isApproximate(opts: { source?: string }): boolean {
    return BoardUiConstants.APPROXIMATE_SOURCE.test(opts.source ?? '');
  }
}
