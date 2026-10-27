/** One request the fake saw: which of its two servers, the path and whether it carried a credential. */
export interface IFakeRequest {
  server: 'api' | 'storage';
  path: string;
  authorization: string | null;
}

export interface IFakeGithub {
  /** Set `VULCAN_GITHUB_API_URL` to this. */
  apiUrl: string;
  requests: IFakeRequest[];
  /** The assets of the rolling release, by name. */
  assets: Map<string, Uint8Array>;
  options: {
    /** Whether the release `atlas-index` exists. */
    release: boolean;
    /** When set, every asset download on the API answers this status. */
    assetStatus?: number;
    /** Asset `url`s that point at the storage host instead of the API host. */
    foreignAssetUrls: boolean;
    /** The storage host accepts a connection and never answers. */
    hangStorage: boolean;
  };
  stopStorage: () => Promise<void>;
  stop: () => Promise<void>;
}

const RELEASE_ID = 7;

/**
 * A GitHub API and a separate storage host, on two local ports: the listing, an asset URL that
 * redirects to the other origin, and a log of what each saw, so a test can tell where a token went.
 */
export const startFakeGithub = (opts: { owner: string; repo: string }): IFakeGithub => {
  const assets = new Map<string, Uint8Array>();
  const requests: IFakeRequest[] = [];
  const options: IFakeGithub['options'] = {
    release: true,
    foreignAssetUrls: false,
    hangStorage: false,
  };
  const names = (): string[] => [...assets.keys()].sort();
  const base = `/repos/${opts.owner}/${opts.repo}`;

  const storage = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;

      requests.push({
        server: 'storage',
        path,
        authorization: request.headers.get('authorization'),
      });

      if (options.hangStorage) {
        await new Promise(() => undefined);
      }

      const name = names()[Number(path.split('/').pop()) - 1];
      const bytes = name === undefined ? undefined : assets.get(name);

      return bytes === undefined ? new Response('missing', { status: 404 }) : new Response(bytes);
    },
  });

  const api = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);
      const apiUrl = url.origin;
      const storageUrl = `http://127.0.0.1:${storage.port}`;

      requests.push({
        server: 'api',
        path: `${url.pathname}${url.search}`,
        authorization: request.headers.get('authorization'),
      });

      if (url.pathname === `${base}/releases/tags/atlas-index`) {
        return options.release
          ? Response.json({ id: RELEASE_ID })
          : new Response('{}', { status: 404 });
      }

      if (url.pathname === `${base}/releases/${RELEASE_ID}/assets`) {
        const perPage = Number(url.searchParams.get('per_page') ?? 30);
        const page = Number(url.searchParams.get('page') ?? 1);
        const listed = names().map((name, index) => ({
          name,
          url: options.foreignAssetUrls
            ? `${storageUrl}/direct/${index + 1}`
            : `${apiUrl}${base}/releases/assets/${index + 1}`,
        }));

        return Response.json(listed.slice((page - 1) * perPage, page * perPage));
      }

      const asset = new RegExp(`^${base}/releases/assets/(\\d+)$`).exec(url.pathname);

      if (asset !== null) {
        return options.assetStatus === undefined
          ? new Response(null, {
              status: 302,
              headers: { location: `${storageUrl}/blob/${asset[1]}` },
            })
          : new Response('no', { status: options.assetStatus });
      }

      return new Response('not found', { status: 404 });
    },
  });

  return {
    apiUrl: `http://127.0.0.1:${api.port}`,
    requests,
    assets,
    options,
    stopStorage: async () => {
      await storage.stop(true);
    },
    stop: async () => {
      await api.stop(true);
      await storage.stop(true);
    },
  };
};
