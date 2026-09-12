export type Role = "visitor" | "member" | "owner";
export type Inquiry = { id: string; handle: string; email: string; phone?: string; classId?: string; question: string; createdAt: number };
export type State = { role: Role; inquiries: Inquiry[] };

export type ClassInfo = { id: string; name: string; schedule: string; coach: string; level: string; duration: string; desc: string };
export type Coach = { id: string; name: string; title: string; bio: string };
export type Testimonial = { quote: string; author: string; detail: string };

export const classes: ClassInfo[] = [
  { id: "foundations", name: "Boxing Foundations", schedule: "Mon & Wed · 6:30 PM", coach: "Maya", level: "Beginner", duration: "60 min", desc: "Footwork, stance, and the four core punches. No experience needed — you'll leave knowing how to move." },
  { id: "sparring", name: "Technical Sparring", schedule: "Tue & Thu · 7:30 PM", coach: "Andre", level: "Intermediate", duration: "75 min", desc: "Controlled, coached sparring. Read your partner, land clean, and defend with intent." },
  { id: "strength", name: "Fight Strength", schedule: "Sat · 10:00 AM", coach: "Tess", level: "All levels", duration: "50 min", desc: "Conditioning built for the ring: explosive power, a strong core, and the engine to go the distance." },
  { id: "hiit", name: "Boxing HIIT", schedule: "Mon & Fri · 6:00 AM", coach: "Tess", level: "All levels", duration: "45 min", desc: "Rounds on the bag, rounds on the floor. A high-intensity sweat that punches back." },
  { id: "womens", name: "Women's Boxing", schedule: "Wed · 7:30 PM", coach: "Maya", level: "Beginner", duration: "60 min", desc: "A supportive, women-only room to build real skills and real confidence, one round at a time." },
  { id: "youth", name: "Youth Boxing (12–16)", schedule: "Sat · 12:00 PM", coach: "Andre", level: "Ages 12–16", duration: "55 min", desc: "Discipline, focus, and fundamentals for teens — coached with patience and a lot of heart." },
];

export const coaches: Coach[] = [
  { id: "maya", name: "Maya Okafor", title: "Head Coach", bio: "Regional Golden Gloves champion. Ten years turning nervous first-timers into confident boxers." },
  { id: "andre", name: "Andre Silva", title: "Sparring & Technique", bio: "Former pro with 18 bouts. Obsessed with clean footwork, timing, and defense that holds up." },
  { id: "tess", name: "Tess Nguyen", title: "Strength & Conditioning", bio: "CSCS-certified. Builds the engine behind every good boxer — power, core, and staying power." },
  { id: "kai", name: "Kai Brooks", title: "Youth Program Lead", bio: "Youth development specialist who makes the gym the best hour of a kid's week." },
];

export const testimonials: Testimonial[] = [
  { quote: "I walked in never having thrown a punch. Six months later I sparred my first round. This place changes people.", author: "Jordan R.", detail: "Member since 2024" },
  { quote: "The coaching is unreal — they actually watch you and fix the small things nobody else notices.", author: "Priya M.", detail: "Foundations → Sparring" },
  { quote: "Best hour of my day. I always leave lighter than I came in.", author: "Dev S.", detail: "Boxing HIIT regular" },
];

const fixtures: Inquiry[] = [
  { id: "inquiry-6", handle: "sam", email: "sam@example.test", classId: "hiit", question: "How early should I arrive for the 6 AM HIIT class?", createdAt: 600 },
  { id: "inquiry-5", handle: "theo", email: "theo@example.test", phone: "555-0197", classId: "youth", question: "My daughter is 13 — is the youth class a good fit for a total beginner?", createdAt: 500 },
  { id: "inquiry-4", handle: "mara", email: "mara@example.test", classId: "womens", question: "Do I need my own gloves for the women's class, or can I borrow a pair?", createdAt: 400 },
  { id: "inquiry-3", handle: "niko", email: "niko@example.test", classId: "strength", question: "Is this appropriate after a long break from training?", createdAt: 300 },
  { id: "inquiry-2", handle: "jo", email: "jo@example.test", phone: "555-0142", classId: "sparring", question: "Can I observe a technical sparring class before joining?", createdAt: 200 },
  { id: "inquiry-1", handle: "lee", email: "lee@example.test", question: "What should I bring for my very first session?", createdAt: 100 },
];

export function freshState(): State { return { role: "visitor", inquiries: fixtures.map((item) => ({ ...item })) }; }
export function signIn(state: State, role: Exclude<Role, "visitor">): State { return { ...state, role }; }
export function submitInquiry(state: State, fields: Omit<Inquiry, "id" | "handle" | "createdAt">): State {
  if (state.role === "visitor") throw new Error("Sign in to send an inquiry.");
  if (!/^\S+@\S+\.\S+$/.test(fields.email)) throw new Error("Enter a valid email address.");
  if (!fields.question.trim()) throw new Error("Tell us what you would like to know.");
  const inquiry: Inquiry = { ...fields, id: `inquiry-${state.inquiries.length + 1}`, handle: state.role === "owner" ? "owner" : "sam", question: fields.question.trim(), createdAt: Math.max(0, ...state.inquiries.map((item) => item.createdAt)) + 1 };
  return { ...state, inquiries: [inquiry, ...state.inquiries] };
}
export function inboxPage(state: State, cursor = 0, size = 2): { rows: Inquiry[]; nextCursor?: number } {
  if (state.role !== "owner") throw new Error("Owner inbox only.");
  const rows = state.inquiries.slice(cursor, cursor + size);
  const nextCursor = cursor + rows.length < state.inquiries.length ? cursor + rows.length : undefined;
  return { rows, nextCursor };
}
