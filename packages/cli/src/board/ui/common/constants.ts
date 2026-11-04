import { BoardConstants } from '../../common/index.ts';

export class BoardLanguages {
  static readonly EN = 'en';
  static readonly VI = 'vi';
}

export class BoardUiConstants {
  /** Names in a flow that are no agent: GitHub's CI and its reviewers. */
  static readonly NOT_AGENTS = new Set<string>([BoardConstants.CI_ACTOR, 'reviewer']);
  /** A line whose `source` says its time was estimated. */
  static readonly APPROXIMATE_SOURCE = /ước lượng/;
  /** An agent not heard from for this long is listed under Earlier, not as a card of its own. */
  static readonly EARLIER_HOURS = 24;
  /** How many days a finished flow stays in the Done group. */
  static readonly DONE_DAYS = 7;
  /** The state text of an idle agent already says it. */
  static readonly IDLE_TEXT = /^rảnh/;
}

/** The words and the order of the tables the page draws; each word is a key of the dictionary. */
export class BoardTables {
  static readonly STAGES = [
    'Đề xuất',
    'Anh duyệt',
    'Thiết kế',
    'Code',
    'PR + CI',
    'Review',
    'Merge',
    'Phát hành',
    'Bàn giao',
  ];
  static readonly STATE_TEXT: Record<string, string> = {
    you: 'Cần anh',
    blocked: 'Bị chặn',
    running: 'Đang chạy',
    parked: 'st.parked',
    done: 'Xong',
  };
  static readonly KIND_TEXT: Record<string, string> = {
    request: 'đề xuất',
    decision: 'quyết định',
    assign: 'giao việc',
    note: 'ghi chú',
    design: 'thiết kế',
    commit: 'code',
    pr: 'PR',
    ci: 'CI',
    review: 'review',
    fix: 'sửa',
    merge: 'merge',
    release: 'phát hành',
    handoff: 'bàn giao',
    msg: 'tin nhắn',
    flow: 'k.flow',
    agent: 'k.agent',
  };
  /** The groups of the list, in order, with the swatch colour and whether they start open. */
  static readonly GROUPS = [
    { key: 'you', label: 'g.you', swatch: 'var(--ink)', open: true },
    { key: 'blocked', label: 'g.blocked', swatch: 'var(--fail)', open: true },
    { key: 'running', label: 'g.running', swatch: 'var(--accent)', open: true },
    { key: 'parked', label: 'g.parked', swatch: 'var(--line-2)', open: false },
    { key: 'done', label: 'g.done', swatch: 'var(--ok)', open: false },
  ];
  /** How the board view orders the cards of a stage. */
  static readonly STATE_ORDER = ['you', 'blocked', 'running', 'parked', 'done'];
}

/** How an agent's state is said: as a pill and as a word in a sentence. */
export class BoardStateWords {
  static readonly PILL: Record<string, string> = {
    working: 'Đang làm',
    you: 'Chờ anh',
    idle: 'Rảnh',
    blocked: 'Bị chặn',
  };
  static readonly WORD: Record<string, string> = {
    working: 'đang làm',
    you: 'chờ anh',
    idle: 'rảnh',
    blocked: 'bị chặn',
  };
}
