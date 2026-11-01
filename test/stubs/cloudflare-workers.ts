// Minimal stand-in for the `cloudflare:workers` module so Durable Object classes can be unit tested
// in Node with a fake ctx (see test/do-harness.ts).
export class DurableObject<Env = unknown> {
  protected ctx: unknown;
  protected env: Env;
  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
