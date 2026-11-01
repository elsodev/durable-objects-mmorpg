// Fetch wrappers for /api/mutes (src/worker/mutes/routes.ts) and the player card. Never throw.
import type { MutedList, MuteResult, PlayerCard } from "../../shared/players";
import { apiCall } from "./friends-api";

export const mutesApi = {
  list: () => apiCall<MutedList>("GET", "/api/mutes"),
  mute: (target: { userId: string } | { name: string }) => apiCall<MuteResult>("POST", "/api/mutes", target),
  unmute: (userId: string) => apiCall<MuteResult>("DELETE", `/api/mutes/${encodeURIComponent(userId)}`),
  card: (userId: string) => apiCall<PlayerCard>("GET", `/api/players/${encodeURIComponent(userId)}/card`),
};

export type MutesApi = typeof mutesApi;
