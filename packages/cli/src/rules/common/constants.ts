export class RuleConstants {
  /** VULCAN's base rules carry it; a project's own rules never do, so the two can never collide. */
  static readonly BASE_NAMESPACE = 'V-';

  /** `W-01` (a project's own) or `V-W-01` (namespaced). */
  static readonly ID_SOURCE = '(?:[A-Z]+-)?[A-Z]-\\d{2}';

  /** `V-W-01`: an ID in the base namespace, defined in the base or pointing at it. */
  static readonly BASE_ID_SOURCE = `${this.BASE_NAMESPACE}[A-Z]-\\d{2}`;
}
