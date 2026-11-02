// /api/feedback calls for the bug button's form and the admin review list.
import { FEEDBACK_PATH, type FeedbackCategory, type FeedbackClientInfo, type FeedbackPage, type FeedbackStatus } from "../../shared/feedback";

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.length <= 200) return body.error;
  } catch {
    // not JSON
  }
  return res.status === 429 ? "Too many reports. Try again later." : "Couldn't send. Try again in a moment.";
}

async function call<T>(input: string, init: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, { credentials: "include", ...init });
  } catch {
    return { ok: false, error: "You seem to be offline. Try again in a moment.", status: 0 };
  }
  if (!res.ok) return { ok: false, error: await readError(res), status: res.status };
  return { ok: true, value: (await res.json()) as T };
}

export function submitFeedback(input: {
  category: FeedbackCategory;
  message: string;
  info: FeedbackClientInfo;
  screenshot: Blob | null;
}): Promise<ApiResult<{ id: string }>> {
  const form = new FormData();
  form.set("category", input.category);
  form.set("message", input.message);
  form.set("info", JSON.stringify(input.info));
  if (input.screenshot) form.set("screenshot", input.screenshot, "screenshot");
  return call(FEEDBACK_PATH, { method: "POST", body: form });
}

export function listFeedback(before: string | null, status: FeedbackStatus | null): Promise<ApiResult<FeedbackPage>> {
  const q = new URLSearchParams();
  if (before) q.set("before", before);
  if (status) q.set("status", status);
  const qs = q.toString();
  return call(`${FEEDBACK_PATH}${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<ApiResult<{ id: string; status: FeedbackStatus }>> {
  return call(`${FEEDBACK_PATH}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
}
