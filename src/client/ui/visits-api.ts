// Fetch wrappers for /api/home/* (see src/worker/visit/routes.ts). Never throw.
import type { HomeCommand, InviteResult, RespondResult, VisitorEntry } from "../../shared/visits";
import { apiCall, type ApiResult } from "./friends-api";
import { commandDoneText, homeCommandRequest } from "./visits-logic";

export const visitsApi = {
  respond: (fromId: string, accept: boolean) =>
    apiCall<RespondResult>("POST", "/api/home/invites/respond", { fromId, accept }),
  kick: (userId: string) => apiCall<{ status: "kicked"; user: VisitorEntry }>("POST", "/api/home/kick", { userId }),
};

/** Runs `/invite name`, `/kick name` or `/uninvite name`; reports the outcome through `notice`. */
export async function runHomeCommand(
  cmd: HomeCommand,
  name: string,
  notice: (text: string, kind: "info" | "error") => void,
): Promise<void> {
  const req = homeCommandRequest(cmd, name);
  if (!req.ok) return notice(req.error, "error");
  const r: ApiResult<InviteResult | { user: VisitorEntry }> = await apiCall("POST", req.path, req.body);
  if (!r.ok) return notice(r.error, "error");
  notice(commandDoneText(cmd, r.data.user?.name ?? req.body.name!), "info");
}
