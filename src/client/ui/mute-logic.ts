// Pure mute filtering for the client (no DOM), tested in test/fe-player-card.test.ts. The server
// already drops whispers, home invites and friend requests from muted players; zone chat, chat
// bubbles, world chat and emotes are hidden here.
import type { MutedEntry } from "../../shared/players";
import { userIdOfEntity } from "../../shared/players";

export class MuteSet {
  private ids = new Map<string, string>();
  private names = new Set<string>();

  static from(entries: readonly Pick<MutedEntry, "userId" | "name">[]): MuteSet {
    const s = new MuteSet();
    for (const e of entries) s.add(e.userId, e.name);
    return s;
  }

  add(userId: string, name: string): void {
    this.ids.set(userId, name);
    if (name) this.names.add(name.toLowerCase());
  }

  remove(userId: string): void {
    const name = this.ids.get(userId);
    this.ids.delete(userId);
    if (name) this.names.delete(name.toLowerCase());
  }

  get size(): number {
    return this.ids.size;
  }

  hasId(userId: string): boolean {
    return this.ids.has(userId);
  }

  /** World chat and whispers carry only the speaker's name (unique ignoring case). */
  hasName(name: string): boolean {
    return !!name && this.names.has(name.toLowerCase());
  }

  /** Zone chat, bubbles and emotes carry the speaker's entity id ("p:<userId>"). */
  hidesEntity(entityId: string): boolean {
    const id = userIdOfEntity(entityId);
    return !!id && this.ids.has(id);
  }

  /** userId of a muted player by name, for `/unmute name`. */
  idByName(name: string): string | null {
    const key = name.toLowerCase();
    for (const [id, n] of this.ids) if (n.toLowerCase() === key) return id;
    return null;
  }
}
