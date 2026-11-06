/* The primitives every screen is composed from. A screen that uses only
   these is correct in all four looks by construction. */
import { useState, type ReactNode } from "react";

/* ---------- the screen shell ------------------------------------------ */

export function Screen({ children }: { children: ReactNode }) {
  return <div className="app">{children}</div>;
}

/* ---------- headers ---------------------------------------------------- */

export function AppHead({ logo, title, sub }: { logo: string; title: string; sub?: string }) {
  return (
    <div className="app-head">
      <span className="logo">{logo}</span>
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
    </div>
  );
}

/* A single subject, centred — the top of a detail screen. */
export function Hero({ emoji, title, sub }: { emoji: string; title: string; sub?: string }) {
  return (
    <div className="hero">
      <span className="big">{emoji}</span>
      <h1>{title}</h1>
      {sub && <p>{sub}</p>}
    </div>
  );
}

export function Crumb({ children }: { children: ReactNode }) {
  return <div className="crumb">‹ {children}</div>;
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="page-title">{children}</h1>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="section-title">{children}</h2>;
}

/* ---------- data display ----------------------------------------------- */

export function Stats({ items }: { items: { value: string; label: string }[] }) {
  return (
    <div className="stats">
      {items.map((item) => (
        <div className="stat" key={item.label}>
          <b>{item.value}</b>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <ul className="list">{children}</ul>;
}

/* `flagged` is the row that wants attention — every look styles it, so use
   it for the one or two rows that matter rather than styling them yourself. */
export function ListRow({
  icon,
  title,
  note,
  action,
  flagged = false,
}: {
  icon: string;
  title: string;
  note?: string;
  action?: ReactNode;
  flagged?: boolean;
}) {
  return (
    <li className={flagged ? "flagged" : undefined}>
      <span className="list-icon">{icon}</span>
      <div className="list-text">
        <b>{title}</b>
        {note && <span>{note}</span>}
      </div>
      {action}
    </li>
  );
}

export function Log({ items }: { items: { text: string; meta: string }[] }) {
  return (
    <ul className="log">
      {items.map((item) => (
        <li key={item.text + item.meta}>
          <span>{item.text}</span>
          <em>{item.meta}</em>
        </li>
      ))}
    </ul>
  );
}

/* ---------- controls --------------------------------------------------- */

export function Chip({ children, ghost = false }: { children: ReactNode; ghost?: boolean }) {
  return <button className={ghost ? "chip ghost" : "chip"}>{children}</button>;
}

export function Cta({ children }: { children: ReactNode }) {
  return <button className="cta">{children}</button>;
}

export function Field({
  label,
  value,
  placeholder,
}: {
  label: string;
  value?: string;
  placeholder?: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type="text" defaultValue={value} placeholder={placeholder} />
    </div>
  );
}

/* Live in the preview: clicking an option moves the selection, so the user
   can feel each look's pressed state rather than being told about it. */
export function Choices({ options, defaultIndex = 0 }: { options: string[]; defaultIndex?: number }) {
  const [at, setAt] = useState(defaultIndex);
  return (
    <div className="choices">
      {options.map((option, i) => (
        <button key={option} className={i === at ? "chip on" : "chip"} onClick={() => setAt(i)}>
          {option}
        </button>
      ))}
    </div>
  );
}
