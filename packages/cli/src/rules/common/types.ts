/** One choice of a slot rule; `settings` merge into `.claude/settings.json` when it is chosen. */
export interface ISlotOption {
  text: string;
  settings?: Record<string, unknown>;
}

/** A base rule whose wording each project picks from fixed options (`base/slots.json`). */
export interface ISlot {
  options: Record<string, ISlotOption>;
}
