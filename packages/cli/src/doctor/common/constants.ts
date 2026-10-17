export class DoctorChecks {
  static readonly CONFIG = 'config';
  static readonly LAYOUT = 'layout';
  static readonly RULE_IDS = 'rule-ids';
  static readonly RULE_SLOTS = 'rule-slots';
  static readonly SKILLS = 'skills';
  static readonly MAKE = 'make';
  static readonly HOOKS = 'hooks';
  static readonly ADAPTERS = 'adapters';
  static readonly STYLE = 'style';
  static readonly MANIFEST = 'manifest';
  static readonly SCHEME_SET = new Set<string>([
    this.CONFIG,
    this.LAYOUT,
    this.RULE_IDS,
    this.RULE_SLOTS,
    this.SKILLS,
    this.MAKE,
    this.HOOKS,
    this.ADAPTERS,
    this.STYLE,
    this.MANIFEST,
  ]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class DoctorConstants {
  static readonly MAKE_INCLUDE_PATTERN =
    /^-?include\s+\S*@venizia\/vulcan\/base\/make\/vulcan\.mk\s*$/m;
  static readonly SHIPPED_HOOKS_PATH = '@venizia/vulcan/base/hooks/';
  static readonly LINT_CONFIG_FILE = /^(oxlint|eslint|oxfmt)\.config\.(mts|ts|mjs|js|cjs)$/;
}
