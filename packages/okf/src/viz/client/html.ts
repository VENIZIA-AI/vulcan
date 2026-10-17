export const escapeHtml = (opts: { text: string }): string =>
  opts.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const escapeAttribute = (opts: { text: string }): string =>
  escapeHtml({ text: opts.text }).replace(/"/g, '&quot;');
