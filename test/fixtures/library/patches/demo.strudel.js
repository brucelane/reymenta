// Demo song (test fixture)
// Sections (bars): A 1-2 | B 3-4
setcpm(120/4)

const bass = note(arrange(
  [2, "e2 ~ e2 b2"],
  [2, "a2 ~ e2 ~"]
)).sound("gm_electric_bass_pick")

const bd = s(arrange(
  [3, "bd ~ ~ ~ bd ~ ~ ~ bd ~ ~ ~ bd ~ ~ ~"],
  [1, "bd ~ ~ bd ~ ~ bd ~"]
)).bank("RolandTR909")

const sd = s(arrange([4, "~ sd ~ sd"])).bank("RolandTR909")

const hh = s(arrange([2, "~"], [2, "hh*8"])).bank("RolandTR909")

stack(bass, bd, sd, hh)
