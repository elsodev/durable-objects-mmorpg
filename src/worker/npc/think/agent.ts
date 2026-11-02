// NpcAgent: one Project Think agent per (NPC, player) pair, named `${npcId}:${userId}`. Its SQLite
// holds that pair's session transcript (FTS-searchable, compacted) and a capped PairMemory record,
// so an NPC only ever remembers the player in front of it.
//
// Cost rules: the model runs only when the caller passes `ai: true`, which NpcRunner does after
// its rules, cache, rate limit and the global AiBudget DO said yes. Compaction summaries reserve
// their own AiBudget units first and fall back to a plain summary. No scheduled tasks: work per
// pair would scale with players, so everything happens on the next conversation.
import { Think, type ThinkModel, type ThinkScheduledTasks, type TurnConfig, type TurnContext } from "@cloudflare/think";
import { createCompactFunction } from "agents/sessions";
import { generateText, wrapLanguageModel, type LanguageModel, type ToolSet, type UIMessage } from "ai";
import type { Env } from "../../env";
import { getNpc } from "../catalog";
import type { NpcId } from "../bible";
import { utcDay } from "../budget-logic";
import { sanitizeLine } from "../text";
import { dedupeDoubledText } from "./dedupe-stream";
import {
  addFact,
  extractFacts,
  isMood,
  loadMemory,
  noteTalk,
  recordFavour,
  recordGift,
  renderPlayerBlock,
  renderWorldBlock,
  setSummary,
  setWorld,
  soulBlock,
  systemPrompt,
  turnInput,
  type PairMemory,
} from "./memory";
import { giftReply, scriptedReply, twoSentences } from "./scripted";
import { npcTools, TOOL_NAMES, validateIntents } from "./tools";
import type { ConverseRequest, ConverseResult, GiftRequest, GiftResult, NpcIntent } from "./types";
import { parsePairName } from "./pair";
import { cleanSituation, renderSituation, type Situation } from "../dialogue";
import { searchQuery } from "./search";

/** Hard stop for one model turn; NpcRunner's own 6 s timeout sits above it. */
export const AGENT_TURN_MS = 5000;
/** AiBudget units for one compaction summary. */
export const COMPACT_UNITS = 20;
const COMPACT_AFTER_TOKENS = 1500;
const KEEP_RECENT_TOKENS = 400;
const TURN_MESSAGES = 8;
const MAX_OUTPUT_TOKENS = 90;
/** Transcript rows kept per pair; above this the transcript is cleared (memory record stays). */
export const MAX_TRANSCRIPT_ROWS = 300;
const TRIM_EVERY_TALKS = 25;
const MEMORY_KEY = "pair_memory";

function textOf(msg: { parts?: { type: string; text?: string }[] } | undefined): string {
  return (msg?.parts ?? [])
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join(" ")
    .trim();
}

function uiText(role: "user" | "assistant", text: string): UIMessage {
  return { id: crypto.randomUUID(), role, parts: [{ type: "text", text }] };
}

export class NpcAgent extends Think<Env> {
  override maxSteps = 1;
  private chain: Promise<unknown> = Promise.resolve();
  private pending: ({ kind: string } & Record<string, unknown>)[] = [];
  private mem: PairMemory | null = null;
  private recalled: string[] = [];
  /** This turn's situation (date, place, hearts), rendered into the "situation" block. */
  private situation: Situation | null = null;

  private pair(): { npcId: NpcId; userId: string } {
    const p = parsePairName(this.name);
    if (!p) throw new Error("bad npc agent name");
    return p;
  }

  private aiAvailable(): boolean {
    return this.env.NPC_AI_MODE !== "off" && !!this.env.AI;
  }

  // ------------------------------------------------------------ Think configuration

  override getModel(): ThinkModel {
    return (this.env.NPC_AGENT_MODEL || this.env.NPC_MODEL) as ThinkModel;
  }

  override resolveModel(model: ThinkModel = this.getModel()): LanguageModel {
    const base = super.resolveModel(model);
    if (typeof base === "string") return base;
    return wrapLanguageModel({ model: base as Parameters<typeof wrapLanguageModel>[0]["model"], middleware: dedupeDoubledText });
  }

  override getSystemPrompt(): string {
    return systemPrompt(this.pair().npcId);
  }

  override configureContext() {
    // Providers resolve the pair lazily: configureContext runs at startup, before any RPC.
    return [
      { label: "soul", description: "Who you are. Read-only.", provider: { get: async () => soulBlock(this.pair().npcId) } },
      {
        label: "player",
        description: "What you remember about the visitor in front of you. Read-only; use the remember tool to add a fact.",
        provider: { get: async () => (this.mem ? renderPlayerBlock(this.mem, this.recalled) : "") },
      },
      { label: "world", description: "News in the valley. Read-only.", provider: { get: async () => renderWorldBlock(this.mem?.world ?? []) } },
      {
        label: "situation",
        description: "Today's date, the time, where you are, how close you are to this visitor, and the tone to take. Read-only.",
        provider: { get: async () => (this.situation ? renderSituation(this.situation) : "") },
      },
    ];
  }

  override configureSession(session: Parameters<Think<Env>["configureSession"]>[0]) {
    return session
      .onCompaction(createCompactFunction({ summarize: (prompt) => this.summarize(prompt), keepRecentTokens: KEEP_RECENT_TOKENS }))
      .compactAfter(COMPACT_AFTER_TOKENS)
      .onCompactionError(() => {});
  }

  override getTools(): ToolSet {
    return npcTools((raw) => this.pending.push(raw));
  }

  /** None: per-pair schedules would multiply with every player. */
  override getScheduledTasks(): ThinkScheduledTasks {
    return {};
  }

  override beforeTurn(ctx: TurnContext): TurnConfig {
    // Recent dialogue only, starting at a user line so no tool result is cut from its call.
    let messages = ctx.messages.slice(-TURN_MESSAGES);
    const firstUser = messages.findIndex((m) => m.role === "user");
    messages = firstUser > 0 ? messages.slice(firstUser) : messages;
    return {
      messages,
      activeTools: [...TOOL_NAMES],
      maxSteps: 1,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxRetries: 0,
      temperature: 0.7,
    };
  }

  // ------------------------------------------------------------ RPC

  /** One exchange with this pair's player. Never throws for normal failures: falls back to scripted. */
  async converse(req: ConverseRequest): Promise<ConverseResult> {
    return this.serial(async () => {
      const { npcId, userId } = this.pair();
      if (req.playerId !== userId) throw new Error("player does not match this agent");
      const now = Date.now();
      const mem = this.load(req.playerName, now);
      setWorld(mem, req.context.world);
      for (const f of extractFacts(req.text)) addFact(mem, f.kind, f.value, now);
      if (req.context.gave) recordFavour(mem, req.context.gave.item, req.context.gave.qty, now);
      this.situation = cleanSituation(req.context.situation);

      let result: ConverseResult | null = null;
      if (req.ai && this.aiAvailable()) result = await this.modelTurn(npcId, userId, mem, req).catch(() => null);
      if (!result) {
        const reply = scriptedReply(npcId, mem, req.context.intent, req.context.interact, Math.random, this.situation ?? undefined);
        await this.log(turnInput(req.playerName, req.text), reply);
        result = { reply, intents: [], source: "scripted" };
      }
      for (const i of result.intents) {
        if (i.kind === "remember") addFact(mem, "note", i.fact, now);
        if (i.kind === "set_mood" && isMood(i.mood)) mem.mood = i.mood;
      }
      noteTalk(mem, req.playerName, now);
      this.save(mem);
      if (mem.talks % TRIM_EVERY_TALKS === 0) await this.trimTranscript();
      return result;
    });
  }

  /** The player handed this NPC an item (already taken from their bag by ZoneRoom). No model call. */
  async receiveGift(req: GiftRequest): Promise<GiftResult> {
    return this.serial(async () => {
      const { npcId, userId } = this.pair();
      if (req.playerId !== userId) throw new Error("player does not match this agent");
      const now = Date.now();
      const mem = this.load(req.playerName, now);
      const out = giftReply(npcId, req.item, mem.playerName, Math.random);
      recordGift(mem, req.item, out.taste, now);
      this.save(mem);
      await this.log(`${mem.playerName} gives you a gift: ${req.item}.`, out.reply);
      return out;
    });
  }

  /** Read-only view of this pair's memory record. */
  async memory(): Promise<PairMemory | null> {
    const { npcId, userId } = this.pair();
    const raw = this.ctx.storage.kv.get(MEMORY_KEY);
    return raw ? loadMemory(raw, npcId, userId, "friend", Date.now()) : null;
  }

  /** Deletes everything this pair stored (account or guest deletion). */
  async forget(): Promise<boolean> {
    this.mem = null;
    await this.destroy();
    return true;
  }

  // ------------------------------------------------------------ internals

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  private load(playerName: string, now: number): PairMemory {
    const { npcId, userId } = this.pair();
    if (!this.mem) this.mem = loadMemory(this.ctx.storage.kv.get(MEMORY_KEY), npcId, userId, playerName, now);
    return this.mem;
  }

  private save(mem: PairMemory): void {
    this.ctx.storage.kv.put(MEMORY_KEY, mem);
  }

  private async log(user: string, reply: string): Promise<void> {
    try {
      await this.addMessages([uiText("user", user), uiText("assistant", reply)], { broadcast: false });
    } catch {
      // The transcript is a nice-to-have; the memory record is what replies depend on.
    }
  }

  private async modelTurn(npcId: NpcId, userId: string, mem: PairMemory, req: ConverseRequest): Promise<ConverseResult | null> {
    this.pending = [];
    this.recalled = await this.recall(req.text);
    await this.context.refreshSystemPrompt();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), AGENT_TURN_MS);
    try {
      const res = await this.runTurn({ input: turnInput(req.playerName, req.text), signal: abort.signal });
      if (res.status !== "completed") return null;
      const line = sanitizeLine(textOf(res.message), getNpc(npcId)?.name ?? npcId);
      const intents: NpcIntent[] = validateIntents(this.pending, { npcId, playerId: userId });
      if (!line) return null;
      return { reply: twoSentences(line), intents, source: "agent" };
    } finally {
      clearTimeout(timer);
      this.pending = [];
    }
  }

  /** Older lines from THIS pair's transcript that match the player's words. */
  private async recall(text: string): Promise<string[]> {
    const q = searchQuery(text);
    if (!q) return [];
    try {
      const hits = await this.session.search(q, { limit: 3 });
      return hits.map((h) => h.content).filter((c) => typeof c === "string" && c.length > 0);
    } catch {
      return [];
    }
  }

  /** Compaction summary: budgeted model call, or a plain summary from the memory record. */
  private async summarize(prompt: string): Promise<string> {
    const mem = this.mem;
    const plain = mem ? `Talked ${mem.talks} times. ${renderPlayerBlock(mem).split("\n").slice(1).join(" ")}`.slice(0, 400) : "Earlier small talk.";
    if (!this.aiAvailable() || !mem || !(await this.reserve(COMPACT_UNITS))) {
      if (mem) setSummary(mem, plain);
      return plain;
    }
    try {
      const out = await generateText({
        model: this.resolveModel(),
        prompt: `Summarize, in at most three short sentences, what this villager should remember about the visitor:\n${prompt.slice(-4000)}`,
        maxOutputTokens: 120,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(4000),
      });
      const text = out.text.trim() || plain;
      setSummary(mem, text);
      return text;
    } catch {
      setSummary(mem, plain);
      return plain;
    }
  }

  private async reserve(units: number): Promise<boolean> {
    try {
      const stub = this.env.AI_BUDGET.get(this.env.AI_BUDGET.idFromName("global"));
      return (await stub.tryConsume({ userId: this.pair().userId, units, day: utcDay(Date.now()) })) === true;
    } catch {
      return false;
    }
  }

  private async trimTranscript(): Promise<void> {
    try {
      const rows = await this.session.getHistoryRowStats();
      if (rows.length > MAX_TRANSCRIPT_ROWS) await this.session.clearMessages();
    } catch {
      // best effort
    }
  }
}

