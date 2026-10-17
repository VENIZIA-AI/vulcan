import { describe, expect, test } from 'bun:test';
import { packageAcrossSources } from '@/common/package-map';
import { RpcError, RpcErrorCodes } from '@/protocol/common';

const SOURCES = [
  { source: 'ignis', packageMap: [{ dir: 'kernel', name: '@venizia/ignis-kernel', aliases: [] }] },
  {
    source: 'ardor',
    packageMap: [{ dir: 'kernel', name: '@venizia/ardor-kernel', aliases: ['k'] }],
  },
];

describe('packageAcrossSources (C2)', () => {
  test('a npm name is unambiguous across sources', () => {
    expect(packageAcrossSources({ value: '@venizia/ardor-kernel', sources: SOURCES })).toEqual({
      source: 'ardor',
      name: '@venizia/ardor-kernel',
    });
  });

  test('a name one source alone knows resolves to it', () => {
    expect(packageAcrossSources({ value: 'k', sources: SOURCES })).toEqual({
      source: 'ardor',
      name: '@venizia/ardor-kernel',
    });
  });

  test('a directory two sources share is an invalid-params error naming both npm names', () => {
    const failure = (() => {
      try {
        return packageAcrossSources({ value: 'kernel', sources: SOURCES });
      } catch (error) {
        return error;
      }
    })();

    expect(failure).toBeInstanceOf(RpcError);
    expect(failure).toMatchObject({
      code: RpcErrorCodes.INVALID_PARAMS,
      message:
        "'kernel' names a package in more than one source - ask by npm name: @venizia/ignis-kernel (ignis), @venizia/ardor-kernel (ardor)",
    });
  });

  test('a name no source knows is undefined', () => {
    expect(packageAcrossSources({ value: 'nope', sources: SOURCES })).toBeUndefined();
  });
});
