// Client store: cave rocks that came back as another ore (silver, gold, diamond).
import { describe, expect, it } from "vitest";
import { createStore } from "../src/client/state/store";
import { getMap } from "../src/shared/maps";
import type { ServerMsg } from "../src/shared/protocol";
import type { Inventory } from "../src/shared/types";

const inv = (): Inventory => ({ coins: 0, slots: Array(24).fill(null) });

describe("client store", () => {
  it("keeps rock ores from the welcome and from rocks coming back", () => {
    const s = createStore();
    const rock = getMap("caves").rocks![0]!;
    s.apply(
      { t: "welcome", zone: "caves", you: "p:me", entities: [], inventory: inv(), rockOres: { [rock.id]: "gold" }, serverTime: 0 } as unknown as ServerMsg,
      0,
    );
    expect(s.rockOres.get(rock.id)).toBe("gold");
    s.apply({ t: "rock", id: rock.id, broken: false, ore: rock.ore } as ServerMsg, 1);
    expect(s.rockOres.has(rock.id)).toBe(false);
    s.apply({ t: "rock", id: rock.id, broken: false, ore: "diamond" } as ServerMsg, 2);
    expect(s.rockOres.get(rock.id)).toBe("diamond");
  });
});

