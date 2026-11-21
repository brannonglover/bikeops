/**
 * Filter chips for the Products and Services lists ("Tubes", "Tires",
 * "Bearings", …). Products and services have no category column, so an item
 * lands under a chip when its name (and, for products, its description)
 * mentions one of the chip's keywords. An item can match several chips.
 *
 * The web dashboard (~/projects/bikeopsco, src/lib/catalog-chips.ts, with
 * tests) keeps an identical copy of this file — change both together.
 */

export interface CatalogChip {
  id: string;
  label: string;
  pattern: RegExp;
  /** Text matching `pattern` is still left out when it also matches this. */
  exclude?: RegExp;
}

export const CATALOG_CHIPS: readonly CatalogChip[] = [
  // "tube" but not "tubeless" — tubeless setups live under Tires.
  { id: "tubes", label: "Tubes", pattern: /\b(?:inner ?)?tubes?\b|\bflat ?(?:fix|repair)\w*|\bpunctures?\b/i },
  {
    id: "tires",
    label: "Tires",
    pattern: /\b(?:tires?|tyres?|tubeless)\b/i,
    // Shops name tubes "Tire Tube 26″" — those belong under Tubes only. Same
    // for tire levers, which are tools.
    exclude: /\btubes?\b|\btire ?levers?\b/i,
  },
  {
    id: "bearings",
    label: "Bearings",
    pattern: /\bbearings?\b|\bbottom ?brackets?\b|\bbb\d*\b|\bheadsets?\b/i,
  },
  {
    id: "brakes",
    label: "Brakes",
    pattern: /\bbrak(?:e|es|ing)\b|\brotors?\b|\bcalipers?\b|\bpads?\b|\bbleed\b/i,
  },
  { id: "chains", label: "Chains", pattern: /\bchains?\b/i },
  {
    id: "drivetrain",
    label: "Drivetrain",
    pattern:
      /\b(?:drivetrain|cassette|chainring|crank|derailleur|freewheel|shifter|shifting|cogs?\b|gears?\b|indexing)/i,
  },
  { id: "cables", label: "Cables", pattern: /\bcables?\b|\bhousings?\b/i },
  {
    id: "wheels",
    label: "Wheels",
    pattern: /\bwheels?(?:sets?)?\b|\brims?\b|\bspokes?\b|\bhubs?\b|\btru(?:e|ing)\b/i,
  },
  {
    id: "suspension",
    label: "Suspension",
    pattern: /\bsuspension\b|\bforks?\b|\bshocks?\b|\blower ?legs?\b|\bdampers?\b/i,
  },
  {
    id: "tune-ups",
    label: "Tune-ups",
    pattern: /\btune(?:[ -]?ups?)?\b|\boverhaul\b|\bsafety check\b|\binspection\b/i,
  },
  { id: "grips", label: "Grips & Tape", pattern: /\bgrips?\b|\bbar ?tape\b|\bhandlebar tape\b/i },
  { id: "saddles", label: "Saddles", pattern: /\bsaddles?\b|\bseat ?posts?\b|\bseats?\b|\bdropper\b/i },
  { id: "pedals", label: "Pedals", pattern: /\bpedals?\b|\bcleats?\b/i },
  { id: "lights", label: "Lights", pattern: /\blights?\b|\blamps?\b|\breflectors?\b/i },
  {
    id: "lube",
    label: "Lube & Care",
    pattern: /\blub(?:e|es|ricant|rication)\b|\bgrease\b|\bdegreaser\b|\bsealant\b|\bwax\b|\boil\b/i,
  },
  {
    id: "ebike",
    label: "E-bike",
    pattern: /\be-?bikes?\b|\bebikes?\b|\bbatter(?:y|ies)\b|\bchargers?\b|\bmotors?\b|\bfirmware\b/i,
  },
  { id: "tools", label: "Tools & Pumps", pattern: /\btools?\b|\bpumps?\b|\btire ?levers?\b|\bco2\b/i },
  {
    id: "assembly",
    label: "Assembly & Fit",
    pattern: /\bassembl(?:y|e)\b|\bbuild(?: ?up)?\b|\bfit(?:ting)?\b|\bunbox/i,
  },
  { id: "cleaning", label: "Cleaning", pattern: /\bclean(?:ing|er)?\b|\bwash\b|\bdetail(?:ing)?\b/i },
];

/** True when `text` belongs under the chip with id `chipId`. Unknown ids match nothing. */
export function matchesCatalogChip(chipId: string, text: string): boolean {
  const chip = CATALOG_CHIPS.find((c) => c.id === chipId);
  return chip ? chipMatches(chip, text) : false;
}

function chipMatches(chip: CatalogChip, text: string): boolean {
  return chip.pattern.test(text) && !chip.exclude?.test(text);
}

/**
 * The chips worth showing for `texts`, in taxonomy order, with how many items
 * each matches. Chips that match nothing are left out, except `keepId` (the
 * selected chip), which stays so it can still be cleared after a search
 * narrows the list.
 */
export function catalogChipCounts(
  texts: readonly string[],
  keepId?: string | null
): { chip: CatalogChip; count: number }[] {
  return CATALOG_CHIPS.map((chip) => ({
    chip,
    count: texts.reduce((n, t) => (chipMatches(chip, t) ? n + 1 : n), 0),
  })).filter(({ chip, count }) => count > 0 || chip.id === keepId);
}
