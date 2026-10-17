// Fixture only - never run. A helper that takes the HTTP verb as its first argument, the shape a
// write once used to reach a live environment without any command line showing it.
declare const api: (method: string, path: string, body?: unknown) => Promise<Response>;

await api('POST', '/inventory-locations/aggregate', { name: 'example' });
await api('DELETE', '/inventory-locations/example-id');

export {};
