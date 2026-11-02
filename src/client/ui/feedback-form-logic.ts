// Pure state for the feedback form: the character counter and when Send is allowed. Mirrors the
// Worker's cleaning so the form never offers to send what the server would refuse.
import { FEEDBACK_MESSAGE_MAX, FEEDBACK_MESSAGE_MIN, cleanFeedbackMessage, codePointLength, type FeedbackItem } from "../../shared/feedback";

export interface FormState {
  counter: string;
  /** Close to or over the cap: the counter turns red. */
  warn: boolean;
  canSend: boolean;
}

export function formState(text: string, sending: boolean): FormState {
  const n = codePointLength(text);
  const cleaned = cleanFeedbackMessage(text);
  return {
    counter: `${n} / ${FEEDBACK_MESSAGE_MAX}`,
    warn: n > FEEDBACK_MESSAGE_MAX * 0.9,
    canSend: !sending && cleaned !== null && n <= FEEDBACK_MESSAGE_MAX && codePointLength(cleaned) >= FEEDBACK_MESSAGE_MIN,
  };
}

/** "1280x720@2": the window's CSS size and pixel ratio, for the report. */
export function viewportText(w: number, h: number, dpr: number): string {
  const r = Math.round((dpr || 1) * 100) / 100;
  return `${Math.round(w)}x${Math.round(h)}@${Math.min(9.99, r)}`;
}

/** "caves (4, 9) · 800x600@1 · webgl": where a report came from, for the admin list. */
export function metaLine(f: Pick<FeedbackItem, "zone" | "x" | "y" | "viewport" | "renderer">): string {
  const parts: string[] = [];
  if (f.zone) parts.push(f.x !== null && f.y !== null ? `${f.zone} (${f.x}, ${f.y})` : f.zone);
  if (f.viewport) parts.push(f.viewport);
  if (f.renderer) parts.push(f.renderer);
  return parts.join(" · ");
}
