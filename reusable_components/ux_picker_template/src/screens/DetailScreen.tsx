import { Crumb, Cta, Hero, Log, Screen, SectionTitle, Stats } from "../kit";

export function DetailScreen() {
  return (
    <Screen>
      <Crumb>Back to plants</Crumb>
      <Hero emoji="🪴" title="Fiddle Leaf Fig" sub="living room · added in May" />
      <Stats
        items={[
          { value: "7", label: "days between" },
          { value: "today", label: "next water" },
          { value: "92%", label: "on time" },
        ]}
      />
      <Cta>💧 Water now</Cta>
      <SectionTitle>History</SectionTitle>
      <Log
        items={[
          { text: "💧 Watered", meta: "Jul 7" },
          { text: "💧 Watered", meta: "Jun 30" },
          { text: "🌿 Fertilized", meta: "Jun 24" },
        ]}
      />
    </Screen>
  );
}
