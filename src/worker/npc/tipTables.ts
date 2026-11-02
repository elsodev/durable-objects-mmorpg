// Game tips each villager shares in their own voice. Every tip states a rule that is true in this
// codebase (the comment above each group names where); change the tip when the rule changes, and
// test/npc-tips.test.ts checks the numbers and keys against the code.
import type { NpcId } from "./bible";

export interface Tip {
  /** Spoken line, at most MAX_TIP_LEN chars; {name} is the player's name. */
  line: string;
  /** Lowercase words a player might use when asking about this ("water", "crops"). */
  about: readonly string[];
}

export const MAX_TIP_LEN = 160;

export const NPC_TIPS: Readonly<Record<NpcId, readonly Tip[]>> = {
  // Goals (worker/game/goals.ts, zone.ts onDonate), town hall desk (shared/ranch.ts), notice board
  // (shared/notices.ts), hearts (shared/hearts.ts), mailbox (shared/mail.ts), chat (ui/chat.ts).
  bram: [
    {
      line: "Ahem! Press G anywhere out in the valley and the village goals open. You can donate right from your bag, no need to walk to the hall!",
      about: ["goal", "goals", "donate", "help", "village", "board"],
    },
    {
      line: "The bridge needs sixty wood, forty stone and ten copper ore. Chop trees with your axe, crack rocks with your pickaxe, and every bit counts!",
      about: ["bridge", "wood", "stone", "copper", "rebuild"],
    },
    {
      line: "My desk in the Town Hall sells farm permits! A barn first, then up to four hens. Each hen lays an egg every morning, and I buy eggs too.",
      about: ["barn", "hen", "hens", "chicken", "egg", "eggs", "animals", "town hall"],
    },
    {
      line: "Want the whole valley to hear you? Pin a note on the notice board by the fountain. It costs two hundred coins and stays up a week.",
      about: ["notice", "board", "note", "post", "message"],
    },
    {
      line: "Talk with each of us once a day, my friend. A friendship left alone fades a little each day. Press H to see how your hearts stand.",
      about: ["friend", "friends", "friendship", "hearts", "heart", "talk", "villagers"],
    },
    {
      line: "Good friends here give presents! At some heart levels a villager may send you furniture, and if your bag is full it waits in your mailbox.",
      about: ["mail", "mailbox", "present", "presents", "furniture", "hearts", "reward"],
    },
    {
      line: "A village is its people, {name}! Press Tab or Enter to chat, and type /world to greet everyone online at once.",
      about: ["chat", "talk", "people", "players", "world", "say"],
    },
  ],

  // Crops (shared/engine/farming.ts, items.ts crop days and regrow), seeds (shared/seeds.ts), crows
  // and scarecrows (engine/homeday.ts), quality (engine/harvest.ts), shop (worker/game/shop.ts).
  odette: [
    {
      line: "Water each crop once a day, love. Today's watering counts tomorrow, so turnips are ready after two watered days, pumpkins after five.",
      about: ["water", "watering", "crop", "crops", "grow", "growing", "turnip", "pumpkin", "farm"],
    },
    {
      line: "Your can is empty? Dip it in the pond or the well on your own farm. It holds twenty splashes, so fill it before you start a row.",
      about: ["water", "watering", "can", "refill", "well", "pond", "empty"],
    },
    {
      line: "Miss a day and they wilt; three dry days in a row and they're gone, dear. Ripe crops don't need water, though. Just pick them!",
      about: ["wilt", "wilted", "dead", "die", "dry", "water", "crops"],
    },
    {
      line: "Turnips, carrots, strawberries and pumpkins are always on my shelf. The rest change with the seasons, each one around for two of them.",
      about: ["seed", "seeds", "season", "seasons", "buy", "shop", "stock"],
    },
    {
      line: "Strawberries keep giving! After the first pick they fruit again every three watered days. Best value on the stall, if you ask me.",
      about: ["strawberry", "strawberries", "regrow", "money", "coins", "profit"],
    },
    {
      line: "Crows love a big open field. A scarecrow from Fenwick keeps them off every crop within eight steps of it.",
      about: ["crow", "crows", "scarecrow", "eaten", "missing", "crops"],
    },
    {
      line: "The more you harvest, the better you get. Seasoned farmers pull silver and gold crops that sell for more and make lovelier gifts.",
      about: ["quality", "silver", "gold", "harvest", "level", "sell", "better"],
    },
    {
      line: "Bring me any crop you grow and I'll pay the full price, same as your shipping bin. Rare seeds come from cave critters, or from good friends.",
      about: ["sell", "selling", "rare", "seeds", "money", "bin"],
    },
  ],

  // Tools and power (shared/engine/toolRules.ts, items.ts), ore prices (items.ts shopSellPrice),
  // furniture stall (worker/game/shop.ts), build and edit mode (client tutorial, game/edit-mode.ts).
  fenwick: [
    {
      line: "Starter pickaxe cracks stone and copper. Iron, silver, gold and gems need the iron pickaxe. Five hundred coins. Worth every one.",
      about: ["pickaxe", "iron", "mine", "mining", "rock", "rocks", "ore", "upgrade"],
    },
    {
      line: "Copper sword hits about twice as hard as the wooden one. Swords sweep an arc. Other tools hit one spot. Mm.",
      about: ["sword", "weapon", "fight", "fighting", "monsters", "combat", "damage"],
    },
    {
      line: "I pay for ore. Less than your shipping bin does, though. Got time? Ship it at home. Need coin now? Sell it here.",
      about: ["ore", "sell", "selling", "bin", "coins", "money", "price"],
    },
    {
      line: "Wrong tool just bounces. Axe for trees, pickaxe for rocks. Big boulders don't break at all. Don't waste the swing.",
      about: ["axe", "tree", "trees", "wood", "rock", "bounce", "tool", "tools"],
    },
    {
      line: "Bought furniture? At home press B to place it, R to turn it. Press T to rearrange the whole house. Del picks a piece back up.",
      about: ["furniture", "build", "place", "house", "home", "decorate", "edit", "move"],
    },
    {
      line: "Furniture stall's on the market lane. Self-serve. Chairs, beds, rugs, lamps, even a fridge. Coins go in the honour box.",
      about: ["furniture", "stall", "fridge", "bed", "chair", "lamp", "buy", "shop"],
    },
    {
      line: "Every swing costs a little energy. Rocks and trees take a few hits each. Pace yourself.",
      about: ["energy", "stamina", "tired", "swing", "mining", "chopping"],
    },
  ],

  // Food and energy (shared/foods.ts, engine/eating.ts, engine/pace.ts), the day (engine/homeclock.ts,
  // homeday.ts passOutPenalty), the bar counter (worker/game/shop.ts COUNTER_KEEPERS), wardrobe and
  // fridge (shared/items.ts, furnitureItems.ts).
  rue: [
    {
      line: "Tired arms, sweetheart? A hot meal gives back loads of energy, a drink a little. Pick it in your hotbar and press Q to eat.",
      about: ["energy", "stamina", "tired", "eat", "food", "hungry", "meal"],
    },
    {
      line: "Out here, Q hands your item to whoever stands next to you. Step away from folk first if you mean to eat it yourself!",
      about: ["eat", "q", "gift", "food", "eating"],
    },
    {
      line: "Run yourself to empty and you're worn out: slow feet, no dashing, no farming. Food helps, but only a night in your own bed fixes it.",
      about: ["worn", "exhausted", "tired", "energy", "stamina", "sleep", "slow"],
    },
    {
      line: "Get to bed before two in the morning, dear. Folk who stay up pass out, lose some coins and wake up only half rested.",
      about: ["sleep", "bed", "night", "late", "pass", "day", "coins"],
    },
    {
      line: "Busy night? Step up to the bar counter and I'll serve you across it. The self-serve bakery stall by the market has sweets and breakfasts too.",
      about: ["inn", "bar", "food", "bakery", "buy", "menu", "drink", "breakfast"],
    },
    {
      line: "Your own crops are food too, love. A strawberry in the pocket beats an empty belly halfway down a cave.",
      about: ["crops", "eat", "snack", "food", "cave", "energy"],
    },
    {
      line: "Fancy a new look? Open the wardrobe in your house and change your clothes, hair, the lot. Every cottage has one.",
      about: ["clothes", "look", "outfit", "wardrobe", "hair", "change", "style"],
    },
    {
      line: "A fridge from the furniture stall keeps twelve stacks of crops and food at home. Saves your bag for the road.",
      about: ["fridge", "storage", "store", "bag", "full", "space", "food"],
    },
  ],

  // Poses and chat (ui/slash-commands.ts, ui/chat.ts), dash (engine/pace.ts), village animals
  // (shared/animals.ts, ranch.ts pet treats), cave chests (shared/chests.ts), clicking villagers.
  pip: [
    {
      line: "Hold Shift while you run and you go SUPER fast! But it tires you out quick, so don't dash everywhere. Aunt Rue says.",
      about: ["dash", "run", "fast", "faster", "shift", "speed"],
    },
    {
      line: "Type /dance and you dance! Or /wave, /cheer, /sit, /think! I do /cheer every time someone comes back from the caves!",
      about: ["dance", "wave", "cheer", "sit", "emote", "emotes", "pose", "fun"],
    },
    {
      line: "Mochi naps by the fountain! Press F next to a cat or dog to pet it. Once a day counts, and if they love you enough you can adopt them!",
      about: ["cat", "dog", "pet", "animal", "animals", "adopt", "mochi"],
    },
    {
      line: "Dogs go crazy for pet treats from the Town Hall, and cats love trout! Hold the food and press Q right next to them!",
      about: ["feed", "treat", "treats", "cat", "dog", "food", "animal"],
    },
    {
      line: "Happy the husky runs off every time you pet him! He hangs around the village and the quarry. He's the hardest one to make friends with.",
      about: ["happy", "husky", "dog", "quarry", "adopt"],
    },
    {
      line: "There are treasure chests in the caves and EVERYBODY gets to open each one! So it's never too late. Tess told me!",
      about: ["chest", "chests", "treasure", "loot", "caves"],
    },
    {
      line: "You can click on a grown-up and you walk right over and talk to them! Way easier than shouting.",
      about: ["talk", "click", "villager", "villagers", "find"],
    },
  ],

  // Riverside forage (shared/spawns.ts FORAGE_RULES), riverside monsters (maps/riverside.ts,
  // engine/monsters.ts NO_GEM_ZONES), map and fast travel (shared/travel.ts, hud M), animals' tastes.
  marlo: [
    {
      line: "Mint and mushrooms grow by the herb patches here... pick 'em and they come back after a few minutes. Iris pays fair for both.",
      about: ["mint", "mushroom", "mushrooms", "forage", "herb", "herbs", "riverside"],
    },
    {
      line: "Slimes sit in the far corners of the meadow, friend... they hop at you if you wander close. Gel's good coin with Iris.",
      about: ["slime", "slimes", "monsters", "gel", "riverside", "fight"],
    },
    {
      line: "No gems in this mud, friend... river slimes never carry 'em. Crystals live deep in the caves.",
      about: ["gem", "gems", "crystal", "crystals", "lantern"],
    },
    {
      line: "Long walk home? Press M for your map... pick a place and you're there before the kettle boils.",
      about: ["map", "travel", "home", "walk", "far", "where", "lost"],
    },
    {
      line: "Cats'll do anything for a trout... the village cats love 'em more than any treat.",
      about: ["cat", "cats", "trout", "fish", "pet", "feed"],
    },
    {
      line: "Hurt? Step out of the fight and sit a spell... wounds close slow when nothing's biting you.",
      about: ["hurt", "health", "hp", "heal", "healing", "hit", "damage"],
    },
  ],

  // Lantern goal (worker/game/goals.ts), gem rocks (maps/caves.ts floor 3, toolRules.ts), the dark
  // and the flashlight (shared/flashlight.ts), fainting (zone.ts faint), bonds and birthdays
  // (shared/hearts.ts), /meditate (ui/slash-commands.ts).
  sable: [
    {
      line: "The lantern asks for one gem crystal, eight iron ore and ten slime gel. Bring them to the goals; G opens them anywhere in the valley.",
      about: ["lantern", "goal", "donate", "gem", "crystal", "iron", "gel", "shrine"],
    },
    {
      line: "Gem rocks lie on the south floor of the caves, where the rock crabs sleep. Only an iron pickaxe will free a crystal.",
      about: ["gem", "crystal", "crystals", "caves", "crab", "crabs", "pickaxe"],
    },
    {
      line: "The caves are dark; your own light reaches only a little way. A flashlight in your bag lights them all. Monsters and chests hide them.",
      about: ["dark", "light", "flashlight", "caves", "see", "lamp"],
    },
    {
      line: "If you fall in the dark, someone carries you home to bed. It costs a few coins, never more than a hundred. Rest, and return.",
      about: ["faint", "fainted", "die", "death", "dead", "lose", "coins", "hurt"],
    },
    {
      line: "A gift on someone's birthday means far more than on any other day. One gift a day, two a week, is all anyone accepts.",
      about: ["gift", "gifts", "birthday", "present", "hearts", "friendship"],
    },
    {
      line: "When your thoughts are loud, type /meditate and sit with them a while. Moving again ends the stillness.",
      about: ["meditate", "rest", "calm", "sit", "quiet", "pose"],
    },
  ],

  // Iris's shop (catalog.ts), monster drops (engine/monsters.ts), deep cave finds (cave-levels JSON),
  // ground drops (shared/spawns.ts GROUND_DROP_MS), forage reach.
  iris: [
    {
      line: "I buy mint, mushrooms and slime gel! Slimes drop gel most times you pop one, and now and then a sprig of mint. Fascinating, right?",
      about: ["slime", "gel", "mint", "sell", "buy", "drops", "monsters"],
    },
    {
      line: "Mushrooms! By the herb patches here, and on the deeper cave floors too. Damp, dark, delightful.",
      about: ["mushroom", "mushrooms", "forage", "where", "caves", "herb"],
    },
    {
      line: "Bag full? What you can't carry drops at your feet and stays yours for three minutes. Walk over it to scoop it up. Observed it myself!",
      about: ["bag", "full", "inventory", "space", "drop", "dropped", "lost"],
    },
    {
      line: "Hypothesis: bats are fragile but quick and hard to hit. Rock crabs are armoured. Bring a sword, not a hoe. Trust the data!",
      about: ["bat", "bats", "crab", "crabs", "monsters", "fight", "sword"],
    },
    {
      line: "Ten slime gel for the shrine lantern, {name}! Sable will be ever so pleased, and so will my notebook.",
      about: ["lantern", "gel", "slime", "goal", "shrine"],
    },
    {
      line: "Bats drop wings, crabs drop shells and sometimes iron. Fenwick buys the shells! Wings are... a specimen for later.",
      about: ["wing", "wings", "shell", "shells", "crab", "bat", "drops"],
    },
  ],

  // Cave layout (maps/caves.ts), rock hits and hit reset (engine/toolRules.ts), deeper levels
  // (shared/caveLevels.ts, cave-levels JSON, engine/monsters.ts levelStats), ladders (shared/climb.ts).
  grumm: [
    {
      line: "Hmph. North chamber's copper and slimes. North-east, iron and bats. South, gems and rock crabs. Start north. Don't argue.",
      about: ["caves", "where", "copper", "iron", "gem", "floor", "map", "mine"],
    },
    {
      line: "Holes in the floor go down to deeper levels. Ladders on the walls bring you back up. Deeper means meaner critters and better rock.",
      about: ["deeper", "down", "ladder", "hole", "level", "levels", "depth"],
    },
    {
      line: "Down deep there's silver, gold and the odd diamond. Gold takes six hits, diamond eight. Bring the iron pickaxe or go home.",
      about: ["silver", "gold", "diamond", "deep", "rare", "ore"],
    },
    {
      line: "Leave a half-cracked rock alone for half a minute and it settles back whole. Finish what you start. Bah.",
      about: ["rock", "rocks", "hits", "mining", "pickaxe", "reset"],
    },
    {
      line: "Pack food before you come down. Mining eats energy, and Rue's stew sits better than an empty belly.",
      about: ["food", "energy", "stamina", "tired", "eat", "mining"],
    },
    {
      line: "Rock crabs look like rocks. Swing at 'em with a pickaxe and you'll learn. Use the sword. Hmph.",
      about: ["crab", "crabs", "rock", "monsters", "sword", "fight"],
    },
  ],

  // Map tab and travel (shared/travel.ts), cave labels (shared/caveLevels.ts), rare monster
  // furniture (shared/furnitureItems.ts), trade/friends/invite (ui/slash-commands.ts, shared/trade.ts).
  tess: [
    {
      line: "Press M for the map! It shows where you are, and you can hop straight home, to the village, the riverside, the quarry or the caves!",
      about: ["map", "travel", "home", "quarry", "where", "lost", "fast"],
    },
    {
      line: "The way here is east of the village, through the quarry. Walk into the cave mouth in the cliff and you're in Grumm's camp!",
      about: ["quarry", "caves", "way", "entrance", "where", "find"],
    },
    {
      line: "Monsters down here sometimes carry rare furniture! Slime statues, crystal lamps, geodes. I've only ever seen a sketch of one!",
      about: ["rare", "furniture", "loot", "drops", "statue", "geode", "lamp"],
    },
    {
      line: "Found something your friend needs? Type /trade and their name when they're close, and swap items and coins safely!",
      about: ["trade", "trading", "swap", "players", "friend", "coins"],
    },
    {
      line: "Exploring's better with friends! Type /friend and a name to add someone, and /invite them over when you're home.",
      about: ["friend", "friends", "invite", "visit", "home", "players", "together"],
    },
    {
      line: "Lost in a deep level? The map names it, like depth three west. Climb a ladder up and you come back where you came down!",
      about: ["lost", "ladder", "depth", "deep", "level", "back", "up"],
    },
  ],
};
