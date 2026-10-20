export const useBeta = (): number => 1;

export function useAlpha(): number {
  return 2;
}

export async function useAsync(): Promise<number> {
  return 3;
}

export const notAHook = 4;
