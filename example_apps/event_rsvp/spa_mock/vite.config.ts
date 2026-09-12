import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({ base: process.env.VITE_BASE ?? "/reference-code/event-rsvp/", plugins: [react()] });
