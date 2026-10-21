import { menusAvailable, promptPlan } from '../ui/index.ts';

/** `label  value` lines with the values in one column. */
export const planLines = (opts: { rows: [label: string, value: string][] }): string[] => {
  const width = Math.max(...opts.rows.map(([label]) => label.length));

  return opts.rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`);
};

/**
 * Before anything is written, a terminal that can draw menus shows what will be written and asks.
 * Without one nothing is asked: flags and pipes keep writing as they always did.
 */
export const confirmWrite = async (opts: { title: string; lines: string[] }): Promise<boolean> =>
  menusAvailable() ? promptPlan(opts) : true;

export const ABORTED = 'aborted: nothing was written';
