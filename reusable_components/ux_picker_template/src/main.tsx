import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./i18n";
import "./frame/looks.css";
import "./frame/frame.css";
import "./kit/kit.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
