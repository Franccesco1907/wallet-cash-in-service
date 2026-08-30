import type { Request } from 'express';

const interceptorOwnedRequests = new WeakSet<Request>();

export function markHttpLifecycleOwned(request: Request): void {
  interceptorOwnedRequests.add(request);
}

export function isHttpLifecycleOwned(request: Request): boolean {
  return interceptorOwnedRequests.has(request);
}
