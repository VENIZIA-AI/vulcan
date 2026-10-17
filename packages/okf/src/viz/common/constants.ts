export class Locales {
  static readonly EN = 'en';
  static readonly VI = 'vi';
  static readonly SCHEME_SET = new Set<string>([this.EN, this.VI]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class VizViews {
  static readonly READ = 'read';
  static readonly MAP = 'map';
  static readonly SCHEME_SET = new Set<string>([this.READ, this.MAP]);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class VizConstants {
  static readonly DATA_ELEMENT_ID = 'okf-data';
  static readonly HOME_TARGET = '@home';
  static readonly OUTPUT_FILE = 'viz.html';
  static readonly HOME_CARD_ITEMS = 4;
  static readonly SEARCH_RESULT_LIMIT = 40;
}

/** The placeholders `template.html` carries; the builder fills them, the client never sees them. */
export class VizTemplateTokens {
  static readonly DATA = '__OKF_DATA__';
  static readonly CLIENT = '__OKF_CLIENT__';
  static readonly BRAND = '__OKF_BRAND__';
}
