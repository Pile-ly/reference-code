/** In-memory fixture and privacy boundary for the API-free demonstration. */
export type User = { id: string; handle: string };
export type PlantKind = "monstera" | "snake" | "pothos" | "succulent" | "palm" | "fern" | "bushy";
export type Plant = {
  id: string;
  name: string;
  createdAt: number;
  photo?: string;
  kind?: PlantKind;
  species?: string;
  room?: string;
  light?: string;
  /** Care interval in days — drives the "water in N days" status. */
  waterEvery?: number;
};
export type Watering = { id: string; plantId: string; createdAt: number; note: string; photo?: string };

const OWNER: User = { id: "owner-demo", handle: "garden-owner" };
const OTHER: User = { id: "visitor-demo", handle: "not-the-owner" };
let user: User | null = null;
let plants: Plant[] = [];
let waterings: Watering[] = [];
let sequence = 0;
const listeners = new Set<() => void>();

const DAY = 86_400_000;

function notify(): void { listeners.forEach((listener) => listener()); }
function id(prefix: string): string { sequence += 1; return `${prefix}-${sequence}`; }

/** Default care interval (days) for a plant kind. */
export function careDays(kind: PlantKind): number {
  return { monstera: 7, snake: 14, pothos: 7, succulent: 16, palm: 9, fern: 4, bushy: 8 }[kind];
}

/** Best-guess kind from a plant's name, so a freshly added plant still gets a
 *  fitting illustration and a sensible watering interval. */
export function kindFor(name: string): PlantKind {
  const n = name.toLowerCase();
  if (/snake|sansevieria/.test(n)) return "snake";
  if (/pothos|ivy|philo|heart/.test(n)) return "pothos";
  if (/aloe|succulent|cact|jade|echeveria|haworthia/.test(n)) return "succulent";
  if (/fern/.test(n)) return "fern";
  if (/palm/.test(n)) return "palm";
  if (/monstera|swiss/.test(n)) return "monstera";
  if (/fig|ficus|rubber|zz|peace|lily|calathea|prayer/.test(n)) return "bushy";
  const kinds: PlantKind[] = ["monstera", "snake", "pothos", "succulent", "palm", "fern", "bushy"];
  let h = 0;
  for (const c of n) h = (h * 31 + c.charCodeAt(0)) | 0;
  return kinds[Math.abs(h) % kinds.length];
}

export function subscribe(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export function currentUser(): User | null { return user; }
export function isOwner(): boolean { return user?.id === OWNER.id; }
export function signIn(kind: "owner" | "other" = "owner"): void { user = kind === "owner" ? OWNER : OTHER; notify(); }
export function signOut(): void { user = null; notify(); }

export function resetMockData(): void {
  sequence = 100;
  const now = Date.now();
  const daysAgo = (d: number) => now - d * DAY;
  plants = [
    { id: "plant-1", name: "Monstera", kind: "monstera", species: "Monstera deliciosa", room: "Living room", light: "Bright indirect", waterEvery: 7, createdAt: daysAgo(320) },
    { id: "plant-2", name: "Snake plant", kind: "snake", species: "Dracaena trifasciata", room: "Bedroom", light: "Low to bright", waterEvery: 14, createdAt: daysAgo(300) },
    { id: "plant-3", name: "Golden pothos", kind: "pothos", species: "Epipremnum aureum", room: "Kitchen shelf", light: "Low to bright", waterEvery: 7, createdAt: daysAgo(210) },
    { id: "plant-4", name: "Aloe vera", kind: "succulent", species: "Aloe barbadensis", room: "Windowsill", light: "Bright direct", waterEvery: 16, createdAt: daysAgo(180) },
    { id: "plant-5", name: "Fiddle-leaf fig", kind: "bushy", species: "Ficus lyrata", room: "Living room", light: "Bright indirect", waterEvery: 8, createdAt: daysAgo(150) },
    { id: "plant-6", name: "Parlor palm", kind: "palm", species: "Chamaedorea elegans", room: "Hallway", light: "Low to medium", waterEvery: 9, createdAt: daysAgo(120) },
    { id: "plant-7", name: "Boston fern", kind: "fern", species: "Nephrolepis exaltata", room: "Bathroom", light: "Medium indirect", waterEvery: 4, createdAt: daysAgo(90) },
    { id: "plant-8", name: "ZZ plant", kind: "bushy", species: "Zamioculcas zamiifolia", room: "Office", light: "Low", waterEvery: 18, createdAt: daysAgo(60) },
  ];
  // Watering histories, newest first overall — the timestamps are relative to
  // now, so the home statuses read as a real week of plant care (some due,
  // some overdue, some just done).
  const w = (plantId: string, d: number, note: string): Watering => ({ id: id("wseed"), plantId, createdAt: daysAgo(d), note });
  waterings = [
    // Most-recent per plant, tuned so the home shows a real spread of care
    // status: the fern is overdue, the pothos is due today, the palm is soon,
    // the rest are comfortably ahead.
    w("plant-1", 1, "A good soak"),
    w("plant-3", 7, "Bottom-watered"),
    w("plant-7", 5, "Bathroom humidity helps"),
    w("plant-6", 8, "Trimmed a browning frond"),
    w("plant-5", 3, "Rotated toward the window"),
    w("plant-2", 6, "Let it dry out first"),
    w("plant-8", 5, "Barely needed it"),
    w("plant-4", 9, "Deep soak, then drain"),
    // Older history, so a few plants have a real timeline to scroll.
    w("plant-1", 9, "New leaf unfurling!"),
    w("plant-1", 18, "Repotted this weekend"),
    w("plant-3", 15, "Snipped a leggy vine"),
    w("plant-7", 10, "Misted the fronds"),
    w("plant-5", 12, "Dusted the leaves"),
    w("plant-2", 22, "Monthly-ish is plenty"),
    w("plant-6", 17, "Looking lush"),
    w("plant-4", 25, "Spring feeding"),
  ];
  user = null;
  notify();
}

export function snapshot(): { plants: Plant[]; waterings: Watering[] } {
  // The privacy boundary is intentional: signed-out and non-owner callers
  // receive no records, rather than a differently shaped private dataset.
  return isOwner() ? { plants: [...plants], waterings: [...waterings] } : { plants: [], waterings: [] };
}

export function addPlant(name: string, opts?: Partial<Omit<Plant, "id" | "name" | "createdAt">>): Plant {
  if (!isOwner()) throw new Error("No data available");
  const kind = opts?.kind ?? kindFor(name);
  const plant: Plant = {
    id: id("plant"),
    name: name.trim(),
    createdAt: Date.now(),
    kind,
    waterEvery: opts?.waterEvery ?? careDays(kind),
    ...opts,
  };
  plants = [...plants, plant]; notify(); return plant;
}

export function addWatering(plantId: string, note = "", photo?: string): Watering {
  if (!isOwner() || !plants.some((plant) => plant.id === plantId)) throw new Error("No data available");
  const watering = { id: id("watering"), plantId, createdAt: Date.now(), note, photo };
  waterings = [watering, ...waterings]; notify(); return watering;
}

export function removeWatering(wateringId: string): void { if (isOwner()) { waterings = waterings.filter((watering) => watering.id !== wateringId); notify(); } }

export function removePlant(plantId: string): void {
  if (!isOwner()) return;
  plants = plants.filter((plant) => plant.id !== plantId);
  waterings = waterings.filter((watering) => watering.plantId !== plantId);
  notify();
}

resetMockData();
