import { describe, expect, test } from 'bun:test';
import { SiteUrl } from '@/common/site-url';

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const NUL = String.fromCharCode(0x00);
const RLO = String.fromCharCode(0x202e);

describe('SiteUrl.parse', () => {
  test('an https address is a base, normalized once, without its trailing slash', () => {
    for (const [value, href] of [
      ['https://wiki.example.com', 'https://wiki.example.com'],
      ['https://wiki.example.com/', 'https://wiki.example.com'],
      ['https://wiki.example.com/docs/', 'https://wiki.example.com/docs'],
      ['https://WIKI.example.com:8443/', 'https://wiki.example.com:8443'],
    ]) {
      expect(SiteUrl.parse({ value })).toEqual({ href });
    }
  });

  test('http is for a loopback host only', () => {
    for (const value of [
      'http://localhost:5173',
      'http://127.0.0.1:5173/',
      'http://[::1]:5173',
      'http://wiki.localhost',
    ]) {
      expect('href' in SiteUrl.parse({ value })).toBe(true);
    }

    expect('problem' in SiteUrl.parse({ value: 'http://wiki.example.com' })).toBe(true);
  });

  test.each([
    ['no scheme', 'wiki.example.com'],
    ['another scheme', 'ftp://wiki.example.com'],
    ['a script', 'javascript:alert(1)'],
    ['credentials', 'https://user:pw@wiki.example.com'],
    ['a user only', 'https://user@wiki.example.com'],
    ['a query', 'https://wiki.example.com/?a=1'],
    ['a bare question mark', 'https://wiki.example.com/?'],
    ['a fragment', 'https://wiki.example.com/#x'],
    ['a port out of range', 'https://wiki.example.com:99999'],
    ['an escape character', `https://wiki.example.com/${ESC}[2J`],
    ['a bell', `https://wiki.example.com/${BEL}`],
    ['a NUL', `https://wiki.example.com/${NUL}`],
    ['a bidirectional override', `https://wiki.example.com/${RLO}`],
    ['a space', 'https://wiki.example.com/a b'],
    ['an empty value', ''],
  ])('%s is refused', (_label, value) => {
    expect('problem' in SiteUrl.parse({ value })).toBe(true);
  });

  test('the problem quotes the value with every unprintable character escaped', () => {
    const result = SiteUrl.parse({ value: `https://a.test/${ESC}[2J${RLO}` });

    expect('problem' in result).toBe(true);

    if ('problem' in result) {
      expect(result.problem).not.toContain(ESC);
      expect(result.problem).not.toContain(RLO);
      expect(result.problem).toContain('\\u001b');
      expect(result.problem).toContain('\\u202e');
    }
  });
});
