import { useEffect, useState } from "react";
import { HelpModal } from "./frame/HelpModal";
import { LookDock } from "./frame/LookDock";
import { WidthToggle } from "./frame/WidthToggle";
import { LOOKS, type LookId } from "./frame/looks";
import { SCREENS } from "./screens";

export function App() {
  const [look, setLook] = useState<LookId>(LOOKS[0].id);
  const [wide, setWide] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  /* The backdrop behind the devices belongs to the look, and the reflow to
     the width — both are classes on <body>, so the choice lives there. */
  useEffect(() => {
    document.body.className = `bg-${look}${wide ? " wide" : ""}`;
  }, [look, wide]);

  const lookName = LOOKS.find((l) => l.id === look)?.name;

  return (
    <>
      <div className="top">
        <span className="name">{lookName}</span>
      </div>

      <div className="screens">
        {SCREENS.map(({ id, label, note, Component }) => (
          <div className="screen" key={id}>
            <div className="screen-label">
              <b>{label}</b>
              <span>{note}</span>
            </div>
            <div className="device">
              <div className={`demo ${look}`}>
                <Component />
              </div>
            </div>
          </div>
        ))}
      </div>

      <WidthToggle wide={wide} onChange={setWide} />
      <LookDock look={look} onChange={setLook} />
      <HelpModal open={helpOpen} onOpen={() => setHelpOpen(true)} onClose={() => setHelpOpen(false)} />
    </>
  );
}
