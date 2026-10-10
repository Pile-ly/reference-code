import { Choices, Crumb, Cta, Field, PageTitle, Screen } from "../kit";

export function AddScreen() {
  return (
    <Screen>
      <Crumb>Back to plants</Crumb>
      <PageTitle>Add a plant</PageTitle>
      <Field label="Name" value="Aloe Vera" />
      <Field label="Where does it live?" placeholder="e.g. kitchen window" />
      <div className="field">
        <label>Water every</label>
        <Choices options={["3 days", "week", "2 weeks"]} defaultIndex={1} />
      </div>
      <Cta>Save plant</Cta>
    </Screen>
  );
}
