export class InitStatuses {
  static readonly CREATED = 'created';
  static readonly UPDATED = 'updated';
  static readonly KEPT = 'kept';
  static readonly ADD = 'add';
  static readonly SKIPPED = 'skipped';
  static readonly SCHEME_SET = new Set<string>([
    this.CREATED,
    this.UPDATED,
    this.KEPT,
    this.ADD,
    this.SKIPPED,
  ]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class InitConstants {
  static readonly NAME_TOKEN = '{{name}}';
  static readonly CONFIG_FLAG = '--config';
}
