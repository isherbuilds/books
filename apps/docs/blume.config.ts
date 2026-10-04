import { defineConfig } from "blume";

export default defineConfig({
  title: "Accly Books",
  description: "Task guides for Accly Books",
  content: { root: "content" },
  // The web build serves this static output at /docs on the app domain.
  deployment: { base: "/docs" },
});
