// A* pathfinding on the collision grid (8-way, no corner cutting).
import type { Vec2 } from "../types";
import { isBlocked, type CollisionGrid } from "./collision";

export const MAX_EXPANSIONS = 2000;
const SQRT2 = Math.SQRT2;

/**
 * Minimal binary min-heap of (node, f) pairs. Scores are stored with the entry because a node
 * can be pushed again with a better f; the stale entry is skipped when popped (lazy deletion).
 */
class Heap {
  private nodes: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.nodes.length;
  }
  private swap(i: number, j: number): void {
    [this.nodes[i], this.nodes[j]] = [this.nodes[j], this.nodes[i]];
    [this.keys[i], this.keys[j]] = [this.keys[j], this.keys[i]];
  }
  push(n: number, key: number): void {
    this.nodes.push(n);
    this.keys.push(key);
    let i = this.nodes.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(p, i);
      i = p;
    }
  }
  pop(): number {
    const top = this.nodes[0];
    const last = this.nodes.length - 1;
    this.swap(0, last);
    this.nodes.pop();
    this.keys.pop();
    const len = this.nodes.length;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < len && this.keys[l] < this.keys[m]) m = l;
      if (r < len && this.keys[r] < this.keys[m]) m = r;
      if (m === i) break;
      this.swap(m, i);
      i = m;
    }
    return top;
  }
}

/** Octile distance: admissible for 8-way movement with diagonal cost sqrt(2). */
function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
}

/**
 * Simple A* on the collision grid, returns tile-centre waypoints (excluding start).
 * Returns [] when already on the goal tile, null when the goal is blocked/unreachable
 * or the search exceeds MAX_EXPANSIONS. The start tile may itself be blocked (e.g. an
 * entity squeezed against a prop), it is only expanded, never entered.
 */
export function findPath(grid: CollisionGrid, from: Vec2, to: Vec2): Vec2[] | null {
  const { width: W, height: H } = grid;
  // Reject garbage targets before allocating W*H search buffers.
  if (!Number.isFinite(from.x) || !Number.isFinite(from.y) || !Number.isFinite(to.x) || !Number.isFinite(to.y)) return null;
  const sx = Math.floor(from.x);
  const sy = Math.floor(from.y);
  const gx = Math.floor(to.x);
  const gy = Math.floor(to.y);
  if (isBlocked(grid, gx, gy)) return null;
  if (sx === gx && sy === gy) return [];
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;

  const N = W * H;
  const g = new Float64Array(N).fill(Infinity);
  const parent = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open = new Heap();
  const start = sy * W + sx;
  const goal = gy * W + gx;
  g[start] = 0;
  open.push(start, octile(sx, sy, gx, gy));

  let expansions = 0;
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue; // stale heap entry
    if (cur === goal) return reconstruct(parent, goal, W);
    closed[cur] = 1;
    if (++expansions > MAX_EXPANSIONS) return null;

    const cx = cur % W;
    const cy = (cur - cx) / W;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (isBlocked(grid, nx, ny)) continue;
        // Diagonals need both orthogonal neighbours free, or the body would clip the corner.
        if (dx !== 0 && dy !== 0 && (isBlocked(grid, cx + dx, cy) || isBlocked(grid, cx, cy + dy))) continue;
        const n = ny * W + nx;
        if (closed[n]) continue;
        const ng = g[cur] + (dx !== 0 && dy !== 0 ? SQRT2 : 1);
        if (ng < g[n]) {
          g[n] = ng;
          parent[n] = cur;
          open.push(n, ng + octile(nx, ny, gx, gy));
        }
      }
    }
  }
  return null;
}

function reconstruct(parent: Int32Array, goal: number, W: number): Vec2[] {
  const out: Vec2[] = [];
  // The start node has parent -1 and is excluded.
  for (let n = goal; parent[n] !== -1; n = parent[n]) {
    const x = n % W;
    out.push({ x: x + 0.5, y: (n - x) / W + 0.5 });
  }
  return out.reverse();
}
