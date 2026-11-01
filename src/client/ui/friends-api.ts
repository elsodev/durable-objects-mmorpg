// Fetch wrappers for /api/friends (see src/worker/friends/routes.ts). Never throw: every call
// resolves to data or a user-facing error message.
import type { FriendRequestResult, FriendsList } from "../../shared/friends";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

const MAX_ERROR_LEN = 160;

export async function apiCall<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method,
      credentials: "include",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as unknown;
    if (res.ok) return { ok: true, data: data as T };
    const err = data && typeof data === "object" ? (data as { error?: unknown }).error : null;
    return {
      ok: false,
      status: res.status,
      error: typeof err === "string" && err ? err.slice(0, MAX_ERROR_LEN) : `Something went wrong (${res.status}).`,
    };
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach the server." };
  }
}

export const friendsApi = {
  list: () => apiCall<FriendsList>("GET", "/api/friends"),
  request: (name: string) => apiCall<FriendRequestResult>("POST", "/api/friends/request", { name }),
  respond: (fromId: string, accept: boolean) =>
    apiCall<{ status: "accepted" | "declined" }>("POST", "/api/friends/respond", { fromId, accept }),
  remove: (userId: string) => apiCall<{ status: "removed" }>("DELETE", `/api/friends/${encodeURIComponent(userId)}`),
};

export type FriendsApi = typeof friendsApi;
