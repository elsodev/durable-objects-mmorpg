// The village notice board's home inside the global SocialRoom: loads and saves the board
// (board.ts has the rules) and pushes changes live to everyone with the board open, whichever
// village copy or building they are in. Zones call it over RPC; coins never pass through here
// (the zone takes them first and refunds a refusal).
import type { NoticePress, NoticeView } from "../../shared/notices";
import { NoticeBoard, tally } from "./board";

/** A player who opened the board gets live updates this long (refreshed by every board call). */
export const WATCH_MS = 15 * 60_000;
const KEY_PREFIX = "notice:";
const COOLDOWN_KEY = "noticeLast";

/** What every board call answers: the board as the caller sees it, plus why it refused (if it did). */
export interface BoardAnswer {
  ok: boolean;
  reason?: string;
  posts: NoticeView[];
  /** When the caller may pin again (absent: now). */
  nextPostAt?: number;
}

export interface DeskHost {
  storage: Pick<DurableObjectStorage, "get" | "put" | "delete" | "list">;
  /** Ids this user muted. */
  mutedBy(userId: string): Promise<Set<string>>;
  /** Marks this user as looking at the board until `until`. */
  watch(userId: string, until: number): void;
  /** Users looking at the board right now. */
  watchers(now: number): string[];
  /** Sends `{ t: "social", payload }` to the user's sockets. */
  push(userId: string, payload: { t: string } & Record<string, unknown>): void;
  /** True for a guest (guests may read but never pin or vote). */
  isGuest(userId: string): boolean;
  /** True while the user is muted from chat for spamming (they can't pin either). */
  chatMuted(userId: string, now: number): boolean;
}

const GUEST = "Create an account to use the notice board.";

export class NoticeDesk {
  private constructor(
    private readonly host: DeskHost,
    private readonly board: NoticeBoard,
  ) {}

  static async load(host: DeskHost): Promise<NoticeDesk> {
    const [records, last] = await Promise.all([host.storage.list({ prefix: KEY_PREFIX }), host.storage.get(COOLDOWN_KEY)]);
    return new NoticeDesk(host, NoticeBoard.from(records.values(), last));
  }

  async list(userId: string, now: number): Promise<BoardAnswer> {
    this.prune(now);
    return this.answer(userId, now, true);
  }

  async post(userId: string, name: string, text: string, id: string, req: string, now: number): Promise<BoardAnswer> {
    this.prune(now);
    if (this.host.isGuest(userId)) return this.answer(userId, now, false, GUEST);
    if (this.host.chatMuted(userId, now)) return this.answer(userId, now, false, "You're muted for spamming. Try again later.");
    const r = this.board.post(userId, name, text, now, id, req);
    if (!r.ok) return this.answer(userId, now, false, r.reason);
    void this.host.storage.put(KEY_PREFIX + r.record.id, r.record);
    void this.host.storage.put(COOLDOWN_KEY, this.board.cooldowns(now));
    this.forget(r.removed);
    this.pushBoard(userId, now);
    return this.answer(userId, now, true);
  }

  async vote(userId: string, id: string, press: NoticePress, now: number): Promise<BoardAnswer> {
    this.prune(now);
    if (this.host.isGuest(userId)) return this.answer(userId, now, false, GUEST);
    const r = this.board.vote(id, userId, press);
    if (!r.ok) return this.answer(userId, now, false, r.reason);
    void this.host.storage.put(KEY_PREFIX + id, r.record);
    const counts = { t: "noticeVotes", id, ...tally(r.record) };
    for (const w of this.host.watchers(now)) if (w !== userId) this.host.push(w, counts);
    return this.answer(userId, now, true);
  }

  async remove(userId: string, id: string, now: number): Promise<BoardAnswer> {
    this.prune(now);
    const r = this.board.remove(id, userId);
    if (!r.ok) return this.answer(userId, now, false, r.reason);
    this.forget([id]);
    this.pushBoard(userId, now);
    return this.answer(userId, now, true);
  }

  private prune(now: number): void {
    const gone = this.board.prune(now);
    if (gone.length > 0) this.forget(gone);
  }

  private forget(ids: string[]): void {
    if (ids.length > 0) void this.host.storage.delete(ids.map((id) => KEY_PREFIX + id));
  }

  private async answer(userId: string, now: number, ok: boolean, reason?: string): Promise<BoardAnswer> {
    this.host.watch(userId, now + WATCH_MS);
    const muted = await this.host.mutedBy(userId);
    const next = this.board.nextPostAt(userId, now);
    return { ok, ...(reason ? { reason } : {}), posts: this.board.view(userId, muted), ...(next !== undefined ? { nextPostAt: next } : {}) };
  }

  /** A notice went up or came down: everyone else looking gets the board as they see it. */
  private pushBoard(except: string, now: number): void {
    for (const w of this.host.watchers(now)) {
      if (w === except) continue;
      void this.host
        .mutedBy(w)
        .then((muted) => this.host.push(w, { t: "notices", posts: this.board.view(w, muted), ...nextOf(this.board, w, now) }))
        .catch(() => {});
    }
  }
}

function nextOf(board: NoticeBoard, userId: string, now: number): { nextPostAt?: number } {
  const next = board.nextPostAt(userId, now);
  return next !== undefined ? { nextPostAt: next } : {};
}
