// The signed-in account's mute list on the client: loaded from /api/mutes at start, updated at once
// on mute/unmute (so chat hides right away), and reloaded when another device changes it
// ({ t: "mutes" } on the social socket). Guests have no list.
import type { MutedEntry } from "../../shared/players";
import { MUTES_NOTICE } from "../../shared/players";
import { onSocial } from "../social-events";
import { MuteSet } from "./mute-logic";
import { mutesApi as defaultApi, type MutesApi } from "./mutes-api";

export interface MuteStore {
  readonly set: MuteSet;
  list(): MutedEntry[];
  refresh(): Promise<void>;
  /** Resolves to the player's name on success, else a user-facing error. */
  mute(target: { userId: string } | { name: string }): Promise<{ error: string } | { name: string }>;
  unmute(userId: string): Promise<{ error: string } | { name: string }>;
  onChange(cb: () => void): () => void;
}

export function createMuteStore(opts: { isGuest(): boolean; api?: MutesApi }): MuteStore {
  const api = opts.api ?? defaultApi;
  let entries: MutedEntry[] = [];
  let set = new MuteSet();
  const subs = new Set<() => void>();
  const changed = (): void => {
    set = MuteSet.from(entries);
    for (const cb of [...subs]) cb();
  };

  async function refresh(): Promise<void> {
    if (opts.isGuest()) return;
    const r = await api.list();
    if (!r.ok) return;
    entries = r.data.muted;
    changed();
  }

  onSocial(MUTES_NOTICE, () => void refresh());
  void refresh();

  return {
    get set() {
      return set;
    },
    list: () => entries,
    refresh,
    async mute(target) {
      if (opts.isGuest()) return { error: "Muting is for accounts. Create an account to keep a mute list." };
      const r = await api.mute(target);
      if (!r.ok) return { error: r.error };
      const { userId, name } = r.data.user;
      if (!entries.some((e) => e.userId === userId)) entries = [{ userId, name, at: Date.now() }, ...entries];
      changed();
      return { name };
    },
    async unmute(userId) {
      const r = await api.unmute(userId);
      const name = entries.find((e) => e.userId === userId)?.name ?? (r.ok ? r.data.user.name : "");
      if (!r.ok && r.status !== 404) return { error: r.error };
      entries = entries.filter((e) => e.userId !== userId);
      changed();
      return { name };
    },
    onChange(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
