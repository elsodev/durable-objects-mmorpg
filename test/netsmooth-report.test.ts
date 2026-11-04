// Prints the network harness numbers for each link profile (run with NETSIM_REPORT=1).
import { it } from "vitest";
import { LINKS, crossingKeys, describe as line, runProfile } from "./netsim";

it.runIf(process.env.NETSIM_REPORT === "1")("network harness report", () => {
  const out: string[] = [];
  for (const [name, p] of Object.entries(LINKS)) out.push(line(name, runProfile(p)));
  const stalls = [3000, 7000, 11000, 15000].map((at, i) => ({ at, ms: [120, 250, 400, 500][i]! }));
  out.push(line("prod+stalls", runProfile(LINKS.prod!, { stalls })));
  out.push(line("prod slow pages", runProfile(LINKS.prod!, { frameMs: 80, slowPages: true })));
  out.push(line("prod+tired", runProfile(LINKS.prod!, { tiredAt: 9000 })));
  const cross = { keys: crossingKeys(), endMs: 25_000, start: { x: 3.5, y: 30.5 }, watcherAt: { x: 62, y: 30.5 } };
  out.push(line("prod crossing", runProfile(LINKS.prod!, cross)));
  out.push(line("prod crossing 4K", runProfile(LINKS.prod!, { ...cross, view: { x: 30, y: 17 } })));
  console.log("\n" + out.join("\n"));
});
