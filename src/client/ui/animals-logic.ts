// Pure rules for the animal card (ui/animals.ts): which buttons it shows and what its status says.
import type { AnimalView } from "../../shared/animals";

export interface AnimalButtons {
  pet: boolean;
  /** Cats and dogs take food; hens are fed by the barn. */
  feed: boolean;
  /** Shown once the village animal can come home with you. */
  adopt: boolean;
}

export function animalButtons(v: AnimalView): AnimalButtons {
  const pettable = v.species !== "chicken";
  return { pet: true, feed: pettable, adopt: !v.yours && !!v.canAdopt };
}

/** One line under the hearts: today's care, then what comes next. */
export function animalStatus(v: AnimalView): string {
  if (v.species === "chicken") return v.pettedToday ? "Clucks happily. Petted today." : "Give her a pat.";
  const done = [v.pettedToday ? "petted" : "", v.fedToday ? "fed" : ""].filter(Boolean);
  const today = done.length ? `Already ${done.join(" and ")} today.` : "Pet once and feed once a day to grow closer.";
  if (v.yours) return `Your pet. ${today}`;
  if (v.adopted) return `You adopted ${v.name}; your copy waits in your yard. ${today}`;
  if (v.canAdopt) return `${v.name} adores you and would love a home!`;
  return today;
}

/** The species word shown beside the name. */
export function speciesLabel(v: AnimalView): string {
  return v.species === "chicken" ? "Hen" : v.species === "cat" ? "Cat" : "Dog";
}
