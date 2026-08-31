export type Role = "public" | "member" | "owner";

export interface Post {
  id: string;
  title: string;
  subtitle: string;
  body: string;
  author: string;
  date?: string;
  category?: string;
  likes: string[];
  comments: Comment[];
}

export interface Comment {
  id: string;
  author: string;
  body: string;
}

export interface Draft {
  id: string;
  title: string;
  subtitle: string;
  body: string;
}

export interface BlogState {
  role: Role;
  posts: Post[];
  drafts: Draft[];
  sequence: number;
}

const initialPosts: Post[] = [
  {
    id: "welcome",
    title: "A small place for considered notes",
    subtitle: "A short manifesto on writing slowly, and in the open, for whoever wanders by.",
    author: "Mira",
    date: "2026-08-20",
    category: "Meta",
    body: `Welcome. This is a quiet corner of the internet for slow, considered writing — the kind that takes a walk before it takes a position.

## Why keep notes in public

Writing in the open changes how you think. A note you might publish gets a second read, a kinder edit, a clearer point.

> The best reason to write is to find out what you actually believe.

Here is the whole arrangement:

- **Anyone can read** every post, signed in or not.
- **Members** can leave a like or a comment.
- **The author** keeps private drafts and publishes when a piece is ready.

That's it. Pull up a chair and read a while.`,
    likes: ["sam", "lena"],
    comments: [
      { id: "wc-1", author: "sam", body: "Glad this is here. Subscribed in spirit." },
      { id: "wc-2", author: "lena", body: "That blockquote got me. Looking forward to more." },
    ],
  },
  {
    id: "writing-badly",
    title: "The case for writing badly first",
    subtitle: "The blank page loses its power the moment you agree to fill it with something clumsy.",
    author: "Mira",
    date: "2026-08-12",
    category: "Craft",
    body: `Every good sentence I have ever written was preceded by a bad one. Usually several.

The trick is to lower the stakes of the first pass so far that starting feels almost free. Write the version you would be embarrassed to show anyone. Then fix it.

> A first draft is just you telling yourself the story.

Perfectionism is procrastination wearing a nicer coat. Beat it by agreeing, in advance, to be bad for a page.`,
    likes: ["sam"],
    comments: [{ id: "wb-1", author: "sam", body: "Needed this today. Closing the outline and just writing." }],
  },
  {
    id: "basil",
    title: "What the basil taught me",
    subtitle: "A windowsill herb has opinions about patience that I keep failing to ignore.",
    author: "Mira",
    date: "2026-08-04",
    category: "Garden",
    body: `The basil forgives almost anything except cold and hurry.

I moved it three times in a week, convinced the light was wrong. It sulked. Left alone by the south window, it doubled.

Some living things only tell you they are fine by staying in one place long enough to prove it. I am trying to take the hint.`,
    likes: [],
    comments: [],
  },
  {
    id: "reading-slowly",
    title: "Reading slowly, on purpose",
    subtitle: "Against the productivity of finishing, in favour of the pleasure of dwelling.",
    author: "Mira",
    date: "2026-07-27",
    category: "Reading",
    body: `I used to count books. Fifty a year, then sixty, as if the number were the point.

Now I reread. I stop mid-paragraph to look out the window. A good sentence deserves to be read twice, and the second time is where it lives.

Speed is a fine tool for email. It is a poor one for anything you actually want to remember.`,
    likes: ["lena"],
    comments: [{ id: "rs-1", author: "lena", body: "Reread a chapter of Le Guin last night because of this." }],
  },
  {
    id: "desk-window",
    title: "A desk by the window",
    subtitle: "On the surprisingly large difference a small change of light can make to a day's work.",
    author: "Mira",
    date: "2026-07-18",
    category: "Notes",
    body: `For years my desk faced a wall. It seemed efficient — nothing to distract me.

I turned it to face the window last spring and the work got better, not worse. It turns out I was not distracted by the world; I was starved of it.

Now I look up, watch a bird decide something, and look back down with the sentence I was missing.`,
    likes: [],
    comments: [],
  },
  {
    id: "daily-walk",
    title: "The quiet power of a daily walk",
    subtitle: "Most of my problems are solved somewhere between the door and the third block.",
    author: "Mira",
    date: "2026-07-09",
    category: "Notes",
    body: `I have never once returned from a walk feeling worse than when I left.

That is a remarkable record for any habit. No app, no subscription, no setup. You put on shoes and let the rhythm do the thinking your desk could not.

The walk is not a break from the work. Often it is the work, wearing a coat.`,
    likes: ["sam", "lena"],
    comments: [],
  },
  {
    id: "commonplace",
    title: "On keeping a commonplace book",
    subtitle: "A centuries-old habit for holding on to the sentences that hold on to you.",
    author: "Mira",
    date: "2026-06-30",
    category: "Craft",
    body: `A commonplace book is where you copy, by hand, the lines you do not want to lose.

The copying is the point. Typing a quote lets it pass through you; writing it makes it stay. Months later you reread the pages and find a version of yourself, curated in other people's words.

> To read without a pen is to eat without tasting.`,
    likes: [],
    comments: [{ id: "cp-1", author: "sam", body: "Started one after reading this. Already three pages in." }],
  },
  {
    id: "coffee-ritual",
    title: "Coffee, and the ritual of beginning",
    subtitle: "The cup matters less than the ten quiet minutes it gives you permission to take.",
    author: "Mira",
    date: "2026-06-21",
    category: "Kitchen",
    body: `I am not precious about the beans. I am precious about the pause.

Grinding, pouring, waiting — the ritual draws a small line between not-working and working. Cross it deliberately and the day starts on purpose instead of by accident.

The coffee is good. The threshold is better.`,
    likes: ["lena"],
    comments: [],
  },
  {
    id: "deleted-app",
    title: "Why I deleted the app",
    subtitle: "An honest accounting of what I lost, what I feared, and what I got back instead.",
    author: "Mira",
    date: "2026-06-11",
    category: "Essays",
    body: `I told myself I used it for the news. I used it for the flinch — the small hit of checking.

The first three days without it were loud with absence. Then the silence turned into something I recognised: attention, returned to me in a lump sum.

I am not against the tools. I am against handing them the first and last minutes of every day.`,
    likes: ["sam"],
    comments: [{ id: "da-1", author: "sam", body: "Did the same in spring. The mornings are unrecognisable." }],
  },
  {
    id: "letters",
    title: "Letters I never sent",
    subtitle: "There is a whole genre of writing whose only reader is the person who wrote it.",
    author: "Mira",
    date: "2026-05-29",
    category: "Essays",
    body: `Some things are true only until you say them to the person, and then they change shape.

So I write the letter and keep it. The writing does the work the sending was only ever a proxy for. I understand what I meant; I am kinder by the last line.

Not every thought needs an audience. Some just need a page.`,
    likes: [],
    comments: [],
  },
  {
    id: "map-garden",
    title: "The map is not the garden",
    subtitle: "On the seductive tidiness of planning, and the humbler truth of actually planting.",
    author: "Mira",
    date: "2026-05-15",
    category: "Garden",
    body: `On paper the beds were perfect: neat rows, tidy spacing, everything in its season.

The garden ignored the paper. The mint staged a coup. The tomatoes leaned toward a light my diagram had not accounted for.

Plans are a way of thinking, not a promise the world signed. The garden grows in the gap between them.`,
    likes: ["lena"],
    comments: [],
  },
  {
    id: "small-tools",
    title: "Small tools, sharp and few",
    subtitle: "Why I stopped collecting apps and started sharpening the three I actually use.",
    author: "Mira",
    date: "2026-04-30",
    category: "Tools",
    body: `Every new tool promises to be the one that finally organises me. Most just add a place to look.

I keep three: a plain text file, a paper notebook, and a timer. They do almost everything, and none of them ping.

The best tool is usually the one you already know so well it has become invisible.`,
    likes: [],
    comments: [],
  },
  {
    id: "finishing",
    title: "Notes on finishing things",
    subtitle: "Starting is loud and celebrated; finishing is quiet, and where the whole reward lives.",
    author: "Mira",
    date: "2026-04-16",
    category: "Craft",
    body: `The last ten percent is a different job than the first ninety. It is less inspiration and more nerve.

Finishing means accepting that the thing in the world will always be smaller than the thing in your head. You ship the smaller, real one anyway.

> Done is a decision, not a feeling.`,
    likes: ["sam", "lena"],
    comments: [{ id: "fi-1", author: "lena", body: "Printed the last line and taped it above my monitor." }],
  },
  {
    id: "six-am",
    title: "The city at six in the morning",
    subtitle: "An hour when the streets belong to bakers, runners, and no one trying to sell you anything.",
    author: "Mira",
    date: "2026-03-28",
    category: "City",
    body: `There is a version of the city that only exists before seven, and almost no one is awake to meet it.

The light is low and forgiving. The bakery is warm. A runner nods like a fellow member of a club with no name and no dues.

I am not a morning person by nature. I am a morning person by envy of the people who get this hour to themselves.`,
    likes: [],
    comments: [],
  },
];

const initialDrafts: Draft[] = [{
  id: "draft-garden",
  title: "Garden observations",
  subtitle: "Not yet published",
  body: `Rough notes from the balcony garden — not ready for the front page yet.

- The basil forgives almost anything except cold.
- Morning light is worth more than fertilizer.
- Everything worthwhile grew slower than I wanted it to.

_A draft stays private until its author decides to publish it._`,
}];

export function freshState(): BlogState {
  return { role: "public", posts: structuredClone(initialPosts), drafts: structuredClone(initialDrafts), sequence: 2 };
}

export const roleName = (role: Role) => role === "owner" ? "Mira (owner)" : role === "member" ? "Sam (member)" : "Public visitor";
const actor = (state: BlogState) => state.role === "owner" ? "mira" : "sam";
const requireMember = (state: BlogState) => { if (state.role === "public") throw new Error("Sign in to do that."); };
const requireOwner = (state: BlogState) => { if (state.role !== "owner") throw new Error("Owner access required."); };
const copy = (state: BlogState): BlogState => structuredClone(state);

export function setRole(state: BlogState, role: Role): BlogState { return { ...state, role }; }

export function addComment(state: BlogState, postId: string, body: string): BlogState {
  requireMember(state);
  if (!body.trim()) throw new Error("Write a comment first.");
  const next = copy(state); const post = next.posts.find((item) => item.id === postId);
  if (!post) throw new Error("Post not found.");
  post.comments.push({ id: `comment-${next.sequence++}`, author: actor(next), body: body.trim() });
  return next;
}

export function likePost(state: BlogState, postId: string): BlogState {
  requireMember(state);
  const next = copy(state); const post = next.posts.find((item) => item.id === postId);
  if (!post) throw new Error("Post not found.");
  const who = actor(next); if (!post.likes.includes(who)) post.likes.push(who);
  return next;
}

export function saveDraft(state: BlogState, fields: Omit<Draft, "id">, id?: string): BlogState {
  requireOwner(state); const next = copy(state);
  const draft = id ? next.drafts.find((item) => item.id === id) : undefined;
  if (draft) Object.assign(draft, fields);
  else next.drafts.push({ id: `draft-${next.sequence++}`, ...fields });
  return next;
}

export function publish(state: BlogState, fields: Omit<Draft, "id">, draftId?: string): BlogState {
  requireOwner(state); const next = copy(state);
  next.posts.unshift({ id: `post-${next.sequence++}`, ...fields, author: "Mira", likes: [], comments: [] });
  if (draftId) next.drafts = next.drafts.filter((draft) => draft.id !== draftId);
  return next;
}

export function updatePost(state: BlogState, id: string, fields: Omit<Draft, "id">): BlogState {
  requireOwner(state); const next = copy(state); const post = next.posts.find((item) => item.id === id);
  if (!post) throw new Error("Post not found."); Object.assign(post, fields); return next;
}

export function deletePost(state: BlogState, id: string): BlogState {
  requireOwner(state); return { ...copy(state), posts: state.posts.filter((post) => post.id !== id) };
}
