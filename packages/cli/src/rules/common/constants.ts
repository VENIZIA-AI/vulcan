export class RuleConstants {
  /** VULCAN's base rules carry it; a project's own rules never do, so the two can never collide. */
  static readonly BASE_NAMESPACE = 'V-';

  /** `W-01` (a project's own) or `V-W-01` (namespaced). */
  static readonly ID_SOURCE = '(?:[A-Z]+-)?[A-Z]-\\d{2}';
}
