export function coalesceInFlight<T>(
  requests: Map<string, Promise<T>>,
  key: string,
  create: () => Promise<T>,
): Promise<T> {
  const existing = requests.get(key);
  if (existing) return existing;

  const request = Promise.resolve().then(create).finally(() => {
    if (requests.get(key) === request) requests.delete(key);
  });
  requests.set(key, request);
  return request;
}

export function createInFlightRequestCache<T>() {
  const requests = new Map<string, Promise<T>>();
  return {
    getOrCreate: (key: string, create: () => Promise<T>) => coalesceInFlight(requests, key, create),
  };
}
