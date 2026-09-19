import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { APP_TITLE } from "./config";
import { router } from "./router";
import "./i18n";
import "./styles/globals.css";

// The static <title> in index.html is a pre-JS fallback; the real title
// comes from config so a copier edits it in ONE place.
document.title = APP_TITLE;

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("root element missing in index.html");
}
createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
