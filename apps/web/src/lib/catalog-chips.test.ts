/**
 * Which Products/Services filter chip a name lands under.
 *
 *   npm run test:chips
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CATALOG_CHIPS, catalogChipCounts, matchesCatalogChip } from "./catalog-chips";

function chipsFor(text: string): string[] {
  return CATALOG_CHIPS.filter((c) => matchesCatalogChip(c.id, text)).map((c) => c.id);
}

describe("catalog chips", () => {
  it("files common products under the expected chip", () => {
    const cases: [string, string][] = [
      ["700x25c Inner Tube Presta 48mm", "tubes"],
      ["26in tube schrader", "tubes"],
      ["Continental GP5000 Tire 700x28", "tires"],
      ["Schwalbe Marathon tyre", "tires"],
      ["Tubeless valve stems", "tires"],
      ["6902-2RS cartridge bearing", "bearings"],
      ["Shimano BB52 Bottom Bracket", "bearings"],
      ["Cane Creek 40 Headset", "bearings"],
      ["Shimano B01S resin brake pads", "brakes"],
      ["SRAM Centerline 160mm rotor", "brakes"],
      ["KMC X11 Chain", "chains"],
      ["Shimano 105 11-32 Cassette", "drivetrain"],
      ["Rear derailleur hanger", "drivetrain"],
      ["Jagwire shift cable + housing", "cables"],
      ["DT Swiss spokes 282mm", "wheels"],
      ["ESI Chunky Grips", "grips"],
      ["Lizard Skins bar tape", "grips"],
      ["WTB Volt saddle", "saddles"],
      ["Shimano SPD pedals", "pedals"],
      ["Lezyne rear light", "lights"],
      ["Finish Line Wet Lube", "lube"],
      ["Orange Seal sealant 8oz", "lube"],
      ["Bosch PowerTube 500 battery", "ebike"],
      ["Park Tool tire levers", "tools"],
      ["Floor pump", "tools"],
    ];
    for (const [name, chip] of cases) {
      assert.ok(chipsFor(name).includes(chip), `${name} → ${chip} (got ${chipsFor(name).join(", ")})`);
    }
  });

  it("files common services under the expected chip", () => {
    const cases: [string, string][] = [
      ["Basic Tune-Up", "tune-ups"],
      ["Full overhaul", "tune-ups"],
      ["Flat fix", "tubes"],
      ["Puncture repair", "tubes"],
      ["Tubeless setup", "tires"],
      ["Hydraulic brake bleed", "brakes"],
      ["Brake adjustment", "brakes"],
      ["Wheel true", "wheels"],
      ["Wheel truing", "wheels"],
      ["Fork lower leg service", "suspension"],
      ["Rear shock service", "suspension"],
      ["Headset overhaul", "bearings"],
      ["Gear indexing", "drivetrain"],
      ["Chain replacement", "chains"],
      ["E-bike diagnostic", "ebike"],
      ["Bike assembly (boxed)", "assembly"],
      ["Bike fitting", "assembly"],
      ["Drivetrain deep clean", "cleaning"],
    ];
    for (const [name, chip] of cases) {
      assert.ok(chipsFor(name).includes(chip), `${name} → ${chip} (got ${chipsFor(name).join(", ")})`);
    }
  });

  it("keeps look-alike words out", () => {
    assert.ok(!chipsFor("Tubeless valve stems").includes("tubes"));
    assert.ok(!chipsFor("Chainring bolts").includes("chains"));
    assert.ok(!chipsFor("Flat pedals").includes("tubes"));
    assert.ok(!chipsFor("Lightweight bottle cage").includes("lights"));
    assert.ok(!chipsFor("Brake levers").includes("tools"));
    assert.ok(!chipsFor("Wheelie bar").includes("wheels"));
  });

  it("keeps tubes named \"Tire Tube\" and tire levers out of Tires", () => {
    // Real product names from a shop's catalog.
    for (const name of ["Tire Tube 16″", "Tire Tube 26″ (Schrader)", "Tire Tube 700 (Presta)"]) {
      assert.deepEqual(chipsFor(name), ["tubes"], name);
    }
    assert.ok(!chipsFor("Park Tool tire levers").includes("tires"));
    assert.ok(chipsFor("Tubeless valve stems").includes("tires"));
  });

  it("matchesCatalogChip ignores unknown ids", () => {
    assert.equal(matchesCatalogChip("tubes", "Inner tube"), true);
    assert.equal(matchesCatalogChip("nope", "Inner tube"), false);
  });

  it("counts only chips that match something, plus the selected one", () => {
    const counts = catalogChipCounts(["Inner tube", "Road tube", "Tire 700x25"], "lights");
    assert.deepEqual(
      counts.map(({ chip, count }) => [chip.id, count]),
      [
        ["tubes", 2],
        ["tires", 1],
        ["lights", 0],
      ]
    );
  });
});
