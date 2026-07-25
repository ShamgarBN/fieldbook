// Pre-render seed list for Cary / Wake Forest, NC (Piedmont).
// Reliable backyard regulars + notable night callers. The grow-on-demand
// pipeline fills in anything heard that isn't here, so this is a strong
// starting library, not an exhaustive checklist.
//
// The first 7 are already generated (approved style pass, 2026-07-10); the
// seed runner skips any species already marked "ready", so re-running is safe.

export interface SeedSpecies {
  species: string;
  scientific: string;
}

export const SEED_SPECIES: SeedSpecies[] = [
  // --- already generated / style-approved ---
  { species: "Northern Cardinal", scientific: "Cardinalis cardinalis" },
  { species: "Carolina Wren", scientific: "Thryothorus ludovicianus" },
  { species: "American Robin", scientific: "Turdus migratorius" },
  { species: "Blue Jay", scientific: "Cyanocitta cristata" },
  { species: "American Goldfinch", scientific: "Spinus tristis" },
  { species: "Carolina Chickadee", scientific: "Poecile carolinensis" },
  { species: "Tufted Titmouse", scientific: "Baeolophus bicolor" },

  // --- doves ---
  { species: "Mourning Dove", scientific: "Zenaida macroura" },

  // --- woodpeckers ---
  { species: "Red-bellied Woodpecker", scientific: "Melanerpes carolinus" },
  { species: "Downy Woodpecker", scientific: "Dryobates pubescens" },
  { species: "Pileated Woodpecker", scientific: "Dryocopus pileatus" },
  { species: "Northern Flicker", scientific: "Colaptes auratus" },

  // --- mimids ---
  { species: "Northern Mockingbird", scientific: "Mimus polyglottos" },
  { species: "Brown Thrasher", scientific: "Toxostoma rufum" },
  { species: "Gray Catbird", scientific: "Dumetella carolinensis" },

  // --- thrushes / bluebird ---
  { species: "Eastern Bluebird", scientific: "Sialia sialis" },

  // --- finches ---
  { species: "House Finch", scientific: "Haemorhous mexicanus" },

  // --- nuthatches (Brown-headed is a Southern pine specialty) ---
  { species: "White-breasted Nuthatch", scientific: "Sitta carolinensis" },
  { species: "Brown-headed Nuthatch", scientific: "Sitta pusilla" },

  // --- towhee & sparrows (several are winter visitors) ---
  { species: "Eastern Towhee", scientific: "Pipilo erythrophthalmus" },
  { species: "Chipping Sparrow", scientific: "Spizella passerina" },
  { species: "Song Sparrow", scientific: "Melospiza melodia" },
  { species: "White-throated Sparrow", scientific: "Zonotrichia albicollis" },
  { species: "Dark-eyed Junco", scientific: "Junco hyemalis" },

  // --- corvids & blackbirds ---
  { species: "American Crow", scientific: "Corvus brachyrhynchos" },
  { species: "Common Grackle", scientific: "Quiscalus quiscula" },

  // --- hummingbird & flycatcher ---
  { species: "Ruby-throated Hummingbird", scientific: "Archilochus colubris" },
  { species: "Eastern Phoebe", scientific: "Sayornis phoebe" },

  // --- warbler (year-round in Southern pines) ---
  { species: "Pine Warbler", scientific: "Setophaga pinus" },

  // --- owls: night callers BirdNET picks up; the 48h collage keeps them
  //     visible into the day (per display logic) ---
  { species: "Barred Owl", scientific: "Strix varia" },
  { species: "Great Horned Owl", scientific: "Bubo virginianus" },
  { species: "Eastern Screech-Owl", scientific: "Megascops asio" },
];
