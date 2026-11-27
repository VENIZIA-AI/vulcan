/** One thing under `.agents/local/`: a child of one of its directories, or the profile file. */
export interface ILocalEntry {
  scope: string;
  name: string;
  /** Where it is, relative to `.agents/local/`: `tmp/job-1`, or a bare name for a stray folder. */
  where: string;
  path: string;
  bytes: number;
  ageMs: number;
  state: string;
  /** Whether `clean` may remove it when its scope is chosen. */
  removable: boolean;
  isSymlink: boolean;
  /** A registered git worktree: removed with `git worktree remove`, then pruned. */
  registered: boolean;
  /** A day file of an event log kept outside the project (`events.dir`): removed only after its folder is checked against the settings. */
  outside?: boolean;
  note: string;
}
