// Fixture only - never run. A verification script that reads and asserts; the guard lets it through.
declare const api: (method: string, path: string) => Promise<Response>;

const response = await api('GET', '/inventory-locations/example-id/stats');

console.log(response.status === 200 ? 'PASS' : 'FAIL');

export {};
