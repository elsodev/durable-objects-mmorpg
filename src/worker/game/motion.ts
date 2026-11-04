// Authoritative player movement shared by ZoneRoom and HomeRoom: held direction or a path from
// moveTo. Movement is integrated in real time between messages, not only once per tick: a new
// input first finishes the old one up to the moment it arrived. Without that, a key held for
// 300 ms could move the player for 200 or 400 ms depending on where the ticks fell, and the
// client's prediction would be corrected (pulled forward after release) on every tick.
//
// Each tick reports the last seq received (`ack`) and how long that input has been applied
// (`ackMs`), so the client can replay exactly the part of its input history the server has not
// simulated yet.
//
// Arrival times jitter by tens of ms on the internet, so a held move that lasted 100 ms on the
// client could last 60 or 160 ms here, and every difference came back as a correction (the
// rubber band). Clients that say how long each move lasted (`ms` on the next move) get "timed"
// moves: the previous move is settled at exactly that length (walking on, or back from where the
// server had guessed ahead to), and the current one is walked ahead from a virtual start time
// until the next message settles it. A movement budget (MOVE_BANK_MS, refilled in real time) keeps
// the total within real time, so claiming long moves can't make anyone faster than walking.
//
// Speed comes from the pace (shared/engine/pace.ts): a held direction with `dash` runs, unless the
// room has marked the player worn out (`tired`) or not allowed to dash here (`canDash`, visitors).
import type { EntityState, Vec2 } from "../../shared/types";
import { MOVE_TO_MIN_INTERVAL_MS } from "../env";
import { findPath, moveGoal, paceSpeed, pathSpeed, pickPace, stepDirection, stepToward, type CollisionGrid, type Pace } from "../../shared/engine";

/** One integration step never covers more than this (a stalled isolate must not teleport anyone). */
export const MAX_STEP_MS = 250;
/**
 * A timed move is walked ahead at most this long past its virtual start without word from the
 * client (a held key is resent every 100 ms, so this rides out a few late packets), then waits.
 */
export const LEAD_CAP_MS = 400;
/**
 * Movement time (ms) a client may claim beyond what the server has walked. It fills in real
 * time. Standing still it stops at IDLE_BANK_MS, so nobody can save up a long dash by waiting;
 * during a walk it may reach MOVE_BANK_MS, which is what a stalled isolate or a burst of late
 * packets owes the player once their moves arrive.
 */
export const IDLE_BANK_MS = 400;
export const MOVE_BANK_MS = 1000;
/** Longest single move a client may claim; anything longer is cut to this (then budgeted). */
export const MAX_CLAIM_MS = 1000;

/** A held move timed by the client: where it started, its virtual start, how much is walked. */
interface Timed {
  x: number;
  y: number;
  facing: EntityState["facing"];
  /** Server time the move counts as started (its predecessor's start plus its length). */
  vt: number;
  /** Ms of this move the entity currently shows. */
  applied: number;
}

export class Motion {
  dx = 0;
  dy = 0;
  path: Vec2[] | null = null;
  /** Highest seq received; reported as `ack`. */
  private seq: number | undefined;
  /** When the input with `seq` started being applied. */
  private seqAt = 0;
  /** Time the entity has been integrated up to; undefined until the first input or tick. */
  private at: number | undefined;
  private lastMoveTo = -Infinity;
  /** Set when an integration step changed the position (lets the tick mark the save dirty). */
  private movedFlag = false;
  /** The last move asked to dash (Shift held). */
  private dash = false;
  /** Worn out: slow walk, no dash. Set by the room from the save. */
  private tired = false;
  /** Visitors walk: their stamina lives in their own home, not here. */
  canDash = true;
  /** Time spent actually moving at dash pace, not yet charged (see takeDashMs). */
  private dashMs = 0;
  /** The current held move, when the client times its moves. */
  private timed: Timed | null = null;
  /** Movement time left to spend (ms), refilled in real time up to MOVE_BANK_MS. */
  private bank = IDLE_BANK_MS;
  private bankAt: number | undefined;

  constructor(now?: number) {
    this.at = now;
  }

  /** Integrates the current input from the last integration time up to `now`. */
  advance(e: EntityState, grid: CollisionGrid, now: number): void {
    const from = this.at ?? now;
    this.at = Math.max(from, now);
    this.refill(this.at);
    const dtMs = Math.min(MAX_STEP_MS, Math.max(0, now - from));
    const bx = e.x;
    const by = e.y;
    const walkSpeed = pathSpeed(this.tired);
    if (this.timed && (this.dx !== 0 || this.dy !== 0)) {
      this.walkAhead(e, grid, this.timed, this.at);
    } else if (this.dx !== 0 || this.dy !== 0) {
      const pace = this.pace();
      const r = stepDirection(e, this.dx, this.dy, paceSpeed(pace), dtMs, grid);
      Object.assign(e, { x: r.x, y: r.y, facing: r.facing, moving: r.moving });
      if (pace === "dash" && r.moving) this.dashMs += dtMs;
    } else if (this.path && this.path.length > 0) {
      let left = dtMs;
      // A short step can reach several waypoints; keep walking with the time that is left.
      while (this.path && this.path.length > 0 && left > 0) {
        const target = this.path[0]!;
        const d = Math.hypot(target.x - e.x, target.y - e.y);
        const r = stepToward(e, target, walkSpeed, left, grid);
        Object.assign(e, { x: r.x, y: r.y, facing: r.facing, moving: r.moving });
        if (r.arrived) {
          this.path.shift();
          left -= Math.min(left, (d / walkSpeed) * 1000);
        } else {
          if (!r.moving) this.path = null; // stuck (something moved into the way)
          left = 0;
        }
        if (this.path && this.path.length === 0) this.path = null;
      }
    } else {
      e.moving = false;
    }
    if (e.x !== bx || e.y !== by) this.movedFlag = true;
    this.showPace(e);
  }

  private refill(now: number): void {
    const cap = this.timed ? MOVE_BANK_MS : IDLE_BANK_MS;
    if (this.bankAt !== undefined) this.bank = Math.max(Math.min(this.bank, cap), Math.min(cap, this.bank + Math.max(0, now - this.bankAt)));
    else this.bank = Math.min(this.bank, cap);
    this.bankAt = Math.max(this.bankAt ?? now, now);
  }

  /** Walks the held direction `ms` from where the entity stands (budget already checked). */
  private walk(e: EntityState, grid: CollisionGrid, ms: number): void {
    const pace = this.pace();
    const r = stepDirection(e, this.dx, this.dy, paceSpeed(pace), ms, grid);
    Object.assign(e, { x: r.x, y: r.y, facing: r.facing, moving: r.moving });
    if (pace === "dash" && r.moving) this.dashMs += ms;
  }

  /** Timed move between messages: walk it up to `now - vt` (capped), as far as the budget allows. */
  private walkAhead(e: EntityState, grid: CollisionGrid, t: Timed, now: number): void {
    const target = Math.min(LEAD_CAP_MS, Math.max(0, now - t.vt));
    const ms = Math.min(target - t.applied, this.bank);
    if (ms > 0) {
      this.walk(e, grid, ms);
      this.bank -= ms;
      t.applied += ms;
    } else if (t.applied >= LEAD_CAP_MS || this.bank <= 0) {
      e.moving = false; // the client went quiet (or ran out of budget): stand and wait for it
    }
  }

  /**
   * Ends the timed move at the length the client says it lasted: walk on if we had not got that
   * far, or redo it from its start if we had guessed ahead. Returns the length actually applied.
   */
  private settle(e: EntityState, grid: CollisionGrid, t: Timed, claimMs: number): number {
    let target = Math.min(Math.max(0, claimMs), MAX_CLAIM_MS);
    if (target > t.applied) {
      const extra = Math.min(target - t.applied, this.bank);
      if (extra > 0) this.walk(e, grid, extra);
      this.bank -= extra;
      target = t.applied + extra;
    } else if (target < t.applied) {
      this.bank += t.applied - target;
      const dashBefore = this.dashMs;
      Object.assign(e, { x: t.x, y: t.y, facing: t.facing });
      this.walk(e, grid, target);
      // The redone stretch was charged already; only the part taken back is refunded.
      this.dashMs = this.pace() === "dash" ? Math.max(0, dashBefore - (t.applied - target)) : dashBefore;
    }
    t.applied = target;
    return target;
  }

  /** The pace a held direction moves at right now. */
  pace(): Pace {
    return pickPace({ dash: this.dash, tired: this.tired, canDash: this.canDash });
  }

  /** What everyone sees: running while a dash actually moves, a slow walk while worn out. */
  private showPace(e: EntityState): void {
    const held = this.dx !== 0 || this.dy !== 0;
    const pace = this.tired ? "tired" : held && e.moving && this.pace() === "dash" ? "dash" : undefined;
    if (pace) e.pace = pace;
    else delete e.pace;
  }

  /** Worn out (or rested): movement so far keeps the old speed, the rest uses the new one. */
  setTired(e: EntityState, grid: CollisionGrid, tired: boolean, now: number): void {
    if (tired === this.tired) return;
    this.advance(e, grid, now);
    // The client can't know when this happened, so the rest of this move runs on server time.
    this.timed = null;
    this.tired = tired;
    this.showPace(e);
  }

  /** A fresh Motion for a player who joins worn out (nothing to integrate yet). */
  static tired(): Motion {
    const m = new Motion();
    m.tired = true;
    return m;
  }

  get isTired(): boolean {
    return this.tired;
  }

  /** Dash time moved since the last call (the room turns it into stamina, see drainDash). */
  takeDashMs(): number {
    const ms = this.dashMs;
    this.dashMs = 0;
    return ms;
  }

  /**
   * A new held direction (or a stop). `ms`: how long the client applied the previous move; with
   * it, a timed previous move is settled at that length instead of at the arrival gap.
   */
  onMove(e: EntityState, grid: CollisionGrid, dx: number, dy: number, seq: number | undefined, now: number, dash = false, ms?: number): void {
    const prev = this.timed;
    let vt = now;
    if (prev && ms !== undefined && (this.dx !== 0 || this.dy !== 0)) {
      this.at = Math.max(this.at ?? now, now);
      this.refill(this.at);
      const bx = e.x;
      const by = e.y;
      vt = prev.vt + this.settle(e, grid, prev, ms);
      if (e.x !== bx || e.y !== by) this.movedFlag = true;
      // Arrived early (a faster route than the chain started on) or very late (a long stall):
      // start this move now instead of ahead or behind.
      const late = this.at - vt;
      if (late < 0 || late > LEAD_CAP_MS) vt = this.at;
    } else {
      this.advance(e, grid, now);
      vt = this.at ?? now;
    }
    this.dx = dx;
    this.dy = dy;
    this.dash = dash && (dx !== 0 || dy !== 0);
    const held = dx !== 0 || dy !== 0;
    if (held) this.path = null;
    this.timed = held && ms !== undefined ? { x: e.x, y: e.y, facing: e.facing, vt, applied: 0 } : null;
    if (!held) e.moving = false;
    this.showPace(e);
    this.noteSeq(seq, now);
  }

  /** Returns false if throttled or unreachable (caller rejects). */
  onMoveTo(grid: CollisionGrid, e: EntityState, x: number, y: number, seq: number | undefined, now: number): boolean {
    this.advance(e, grid, now);
    this.noteSeq(seq, now);
    this.timed = null;
    if (now - this.lastMoveTo < MOVE_TO_MIN_INTERVAL_MS) return false;
    this.lastMoveTo = now;
    const path = findPath(grid, e, { x, y });
    if (!path) return false;
    this.dx = 0;
    this.dy = 0;
    this.dash = false;
    // End on the clicked point (kept inside the goal tile, see moveGoal), not the tile centre.
    const goal = moveGoal(grid, { x, y });
    if (path.length > 0) path[path.length - 1] = goal;
    this.path = path.length > 0 ? path : [goal];
    return true;
  }

  private noteSeq(seq: number | undefined, now: number): void {
    if (seq === undefined) return;
    this.seq = seq;
    this.seqAt = now;
  }

  /** No held direction and no path: stepping would not move the player. */
  get idle(): boolean {
    return this.dx === 0 && this.dy === 0 && !this.path;
  }

  stop(): void {
    this.timed = null;
    this.dx = 0;
    this.dy = 0;
    this.dash = false;
    this.path = null;
  }

  /** True once after any step that moved the entity. */
  takeMoved(): boolean {
    const m = this.movedFlag;
    this.movedFlag = false;
    return m;
  }

  /** Brings the entity up to `now` (call once per tick); returns the seq to ack (undefined if none received). */
  step(e: EntityState, grid: CollisionGrid, now: number): number | undefined {
    this.advance(e, grid, now);
    return this.seq;
  }

  /** How long (ms, as of `now`) the acked input has been applied; undefined with no seq. */
  ackMs(now: number): number | undefined {
    if (this.seq === undefined) return undefined;
    if (this.timed) return this.timed.applied;
    return Math.max(0, now - this.seqAt);
  }
}
