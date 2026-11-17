import { RpcError, RpcErrorCodes } from '@/protocol/common';

const KNOWN_VALUES_MAX = 10;

const listOf = (values: string[]): string => values.slice(0, KNOWN_VALUES_MAX).join(', ');

/** The invalid-params errors the tools share, so one mistake is worded the same by every tool. */
export class ToolErrors {
  static invalidParams(message: string): RpcError {
    return new RpcError({ code: RpcErrorCodes.INVALID_PARAMS, message });
  }

  static unknownPackage(opts: { name: string; known: string[] }): RpcError {
    return ToolErrors.invalidParams(
      `unknown package '${opts.name}'; known packages: ${listOf(opts.known)}`,
    );
  }

  static unknownVersion(opts: { package: string; version: string; known: string[] }): RpcError {
    return ToolErrors.invalidParams(
      `unknown version '${opts.version}' for ${opts.package}; known versions: ${listOf(opts.known)}`,
    );
  }
}
