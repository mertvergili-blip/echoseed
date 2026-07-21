import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import "./styles.css";

const root = document.getElementById("root")!;
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary label="Terrarium">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
