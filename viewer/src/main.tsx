import "@radix-ui/themes/styles.css";
import "./app.css";
import { ThemeProvider } from "next-themes";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class">
      <App />
    </ThemeProvider>
  </StrictMode>
);
