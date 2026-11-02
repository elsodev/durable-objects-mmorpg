// The town hall counter (the mayor's desk): farm permits and livestock. It sells the barn (built
// in your yard, never put in the bag), hens (they go to your barn) and pet treats, and buys
// eggs. Opened with the ordinary shop dialog under the TOWNHALL_SHOP id.
import type { AnimalSave } from "../../shared/animals";
import type { ServerMsg } from "../../shared/protocol";
import type { Inventory, ItemId } from "../../shared/types";
import {
  BARN_ITEM,
  buyBarn,
  buyChickens,
  CHICKEN_ITEM,
  TOWNHALL_BUYS,
  TOWNHALL_NAME,
  TOWNHALL_SHOP,
  townhallOffers,
  type RanchBuy,
} from "../../shared/ranch";
import { buyFrom, sellTo, type TradeResult } from "./shop";

export function townhallShop(save: AnimalSave): Extract<ServerMsg, { t: "shop" }> {
  return { t: "shop", npc: TOWNHALL_SHOP, name: TOWNHALL_NAME, offers: townhallOffers(save), buys: [...TOWNHALL_BUYS] };
}

/** Buys from the counter: the barn and hens change the save, anything else goes in the bag. */
export function townhallBuy(save: AnimalSave, inv: Inventory, item: ItemId, qty: number): RanchBuy | TradeResult {
  if (item === BARN_ITEM) return qty === 1 ? buyBarn(save, inv) : { ok: false, reason: "One barn is plenty." };
  if (item === CHICKEN_ITEM) return buyChickens(save, inv, qty);
  return buyFrom(inv, { sells: townhallOffers(save), buys: [...TOWNHALL_BUYS] }, item, qty);
}

export function townhallSell(inv: Inventory, slot: number, qty: number): TradeResult {
  return sellTo(inv, { sells: [], buys: [...TOWNHALL_BUYS] }, slot, qty);
}
