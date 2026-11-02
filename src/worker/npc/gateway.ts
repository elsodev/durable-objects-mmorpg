// Every NPC model call (lines, Think agent turns, Jev) goes through one AI Gateway when
// AI_GATEWAY_ID is set: one place for logs, caching and Unified Billing of third-party models.
export function gatewayOptions(id: string | undefined): GatewayOptions | undefined {
  return id ? { id } : undefined;
}
