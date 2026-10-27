import { recordOf } from '@/prebuilt/wire';

/** One request the fake saw: which of its two servers, the method, the path and whether it carried a credential. */
export interface IFakeRequest {
  server: 'api' | 'storage';
  method: string;
  path: string;
  authorization: string | null;
}

export interface IFakeGithub {
  /** Set `VULCAN_GITHUB_API_URL` (a reader) or `GITHUB_API_URL` (a publisher) to this. */
  apiUrl: string;
  requests: IFakeRequest[];
  /** The assets of the rolling release, by name. */
  assets: Map<string, Uint8Array>;
  /** When each asset was uploaded; an asset a test puts in `assets` directly is as old as `epoch`. */
  createdAt: Map<string, string>;
  /** The bodies of every `POST /releases` the fake accepted. */
  releasesCreated: Record<string, unknown>[];
  options: {
    /** Whether the release `atlas-index` exists. */
    release: boolean;
    /** When set, every asset download on the API answers this status. */
    assetStatus?: number;
    /** Asset `url`s that point at the storage host instead of the API host. */
    foreignAssetUrls: boolean;
    /** The release's `upload_url` names the storage host instead of the API host. */
    foreignUploadUrl: boolean;
    /** The storage host accepts a connection and never answers. */
    hangStorage: boolean;
  };
  stopStorage: () => Promise<void>;
  stop: () => Promise<void>;
}

const RELEASE_ID = 7;
const EPOCH = '2026-01-01T00:00:00Z';

/**
 * A GitHub API and a separate storage host, on two local ports: the listing, an asset URL that
 * redirects to the other origin, the calls a publisher makes (create the release, delete and upload an
 * asset), and a log of what each saw, so a test can tell where a token went and in what order.
 */
export const startFakeGithub = (opts: { owner: string; repo: string }): IFakeGithub => {
  const assets = new Map<string, Uint8Array>();
  const createdAt = new Map<string, string>();
  const ids = new Map<string, number>();
  const requests: IFakeRequest[] = [];
  const releasesCreated: Record<string, unknown>[] = [];
  const options: IFakeGithub['options'] = {
    release: true,
    foreignAssetUrls: false,
    foreignUploadUrl: false,
    hangStorage: false,
  };
  const base = `/repos/${opts.owner}/${opts.repo}`;
  let nextId = 100;
  const idOf = (name: string): number => {
    const known = ids.get(name);

    if (known !== undefined) {
      return known;
    }

    nextId += 1;
    ids.set(name, nextId);

    return nextId;
  };
  const nameOf = (id: number): string | undefined =>
    [...assets.keys()].find((name) => idOf(name) === id);

  const storage = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;

      requests.push({
        server: 'storage',
        method: request.method,
        path,
        authorization: request.headers.get('authorization'),
      });

      if (options.hangStorage) {
        await new Promise(() => undefined);
      }

      const name = nameOf(Number(path.split('/').pop()));
      const bytes = name === undefined ? undefined : assets.get(name);

      return bytes === undefined ? new Response('missing', { status: 404 }) : new Response(bytes);
    },
  });

  const api = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      const apiUrl = url.origin;
      const storageUrl = `http://127.0.0.1:${storage.port}`;
      const release = (): Response =>
        Response.json(
          Object.fromEntries([
            ['id', RELEASE_ID],
            [
              'upload_url',
              `${options.foreignUploadUrl ? storageUrl : apiUrl}${base}/releases/${RELEASE_ID}/assets{?name,label}`,
            ],
          ]),
        );

      requests.push({
        server: 'api',
        method: request.method,
        path: `${url.pathname}${url.search}`,
        authorization: request.headers.get('authorization'),
      });

      if (url.pathname === `${base}/releases/tags/atlas-index`) {
        return options.release ? release() : new Response('{}', { status: 404 });
      }

      if (url.pathname === `${base}/releases` && request.method === 'POST') {
        if (options.release) {
          return new Response('{}', { status: 422 });
        }

        options.release = true;
        releasesCreated.push(recordOf({ value: await request.json() }));

        return new Response(await release().text(), { status: 201 });
      }

      if (url.pathname === `${base}/releases/${RELEASE_ID}/assets` && request.method === 'GET') {
        const perPage = Number(url.searchParams.get('per_page') ?? 30);
        const page = Number(url.searchParams.get('page') ?? 1);
        const listed = [...assets.keys()].sort().map((name) =>
          Object.fromEntries([
            ['id', idOf(name)],
            ['name', name],
            ['created_at', createdAt.get(name) ?? EPOCH],
            [
              'url',
              options.foreignAssetUrls
                ? `${storageUrl}/direct/${idOf(name)}`
                : `${apiUrl}${base}/releases/assets/${idOf(name)}`,
            ],
          ]),
        );

        return Response.json(listed.slice((page - 1) * perPage, page * perPage));
      }

      if (url.pathname === `${base}/releases/${RELEASE_ID}/assets` && request.method === 'POST') {
        const name = url.searchParams.get('name') ?? '';

        assets.set(name, new Uint8Array(await request.arrayBuffer()));
        createdAt.set(name, new Date().toISOString());

        return Response.json({ id: idOf(name), name }, { status: 201 });
      }

      const asset = new RegExp(`^${base}/releases/assets/(\\d+)$`).exec(url.pathname);

      if (asset !== null && request.method === 'DELETE') {
        const name = nameOf(Number(asset[1]));

        if (name !== undefined) {
          assets.delete(name);
          createdAt.delete(name);
        }

        return new Response(null, { status: name === undefined ? 404 : 204 });
      }

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
    createdAt,
    releasesCreated,
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
