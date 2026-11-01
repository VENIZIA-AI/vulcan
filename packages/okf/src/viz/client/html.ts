export class HtmlText {
  static escape(opts: { text: string }): string {
    return opts.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  static escapeAttribute(opts: { text: string }): string {
    return HtmlText.escape({ text: opts.text }).replace(/"/g, '&quot;');
  }
}
