// JSON maps: parse + build. See docs/guides/json-maps.md.
import type { MapData, ZoneId } from "../../types";
import { buildFromSpec } from "./build";
import { MapSpecError, parseMapSpec } from "./parse";

export { buildFromSpec, edgePassage } from "./build";
export { checkMapLinks } from "./links";
export { MapSpecError, parseMapSpec } from "./parse";
export type { MapSpec } from "./spec";

/** Checks and builds one JSON map; `expect` is the zone id the file must declare. */
export function loadJsonMap(raw: unknown, file: string, expect?: ZoneId): MapData {
  const spec = parseMapSpec(raw, file);
  if (expect && spec.id !== expect) throw new MapSpecError(file, "id", `is "${spec.id}", expected "${expect}"`);
  return buildFromSpec(spec);
}
