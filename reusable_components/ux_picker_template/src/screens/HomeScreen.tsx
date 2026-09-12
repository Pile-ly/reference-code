import { AppHead, Chip, Cta, List, ListRow, Screen, Stats } from "../kit";

/* Sample content, written plainly. It is a placeholder for the user to
   judge a look against, so write it in their language and make it
   believable — empty boxes are hard to judge. */
export function HomeScreen() {
  return (
    <Screen>
      <AppHead logo="🌿" title="Sprout" sub="4 plants · 2 need water" />
      <Stats
        items={[
          { value: "4", label: "plants" },
          { value: "2", label: "due today" },
          { value: "12", label: "day streak" },
        ]}
      />
      <List>
        <ListRow flagged icon="🪴" title="Fiddle Leaf Fig" note="water today" action={<Chip>Water</Chip>} />
        <ListRow flagged icon="🌱" title="Basil" note="2 days overdue" action={<Chip>Water</Chip>} />
        <ListRow icon="🍃" title="Monstera" note="in 2 days" action={<Chip ghost>Done</Chip>} />
        <ListRow icon="🌵" title="Snake Plant" note="in 6 days" action={<Chip ghost>Done</Chip>} />
      </List>
      <Cta>＋ Add a plant</Cta>
    </Screen>
  );
}
