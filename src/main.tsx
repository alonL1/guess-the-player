import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import "./index.css";
import { ACTIVE_SPORT } from "./lib/sports";

document.body.dataset.sport = ACTIVE_SPORT.id;
document.documentElement.dataset.sport = ACTIVE_SPORT.id;
document.title = ACTIVE_SPORT.title;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
