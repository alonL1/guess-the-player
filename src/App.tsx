import { Navigate, Route, Routes, useParams } from "react-router-dom";

import { CatalogInspector } from "@/components/CatalogInspector";
import { DailyChallenge } from "@/components/DailyChallenge";
import { LandingPage } from "@/components/LandingPage";
import { RoomClient } from "@/components/RoomClient";
import { SoloClient } from "@/components/SoloClient";
import { ACTIVE_SPORT } from "@/lib/sports";

function BasketballCourtBackground() {
  if (ACTIVE_SPORT.id !== "nba") return null;

  return (
    <div className="nba-court-background" aria-hidden="true">
      <svg viewBox="0 0 500 470" preserveAspectRatio="xMidYMax meet" focusable="false">
        <path className="nba-court-line nba-court-three-point" d="M30 470V328 A237.5 237.5 0 0 1 470 328V470" />

        <path className="nba-court-key-fill" d="M170 470V280H330V470" />
        <path
          className="nba-court-key-lines"
          d="M170 470V280H330V470 M170 325H186 M170 365H186 M170 405H186 M314 325H330 M314 365H330 M314 405H330"
        />
        <path className="nba-court-line" d="M190 280 A60 60 0 0 1 310 280" />
        <path className="nba-court-dash" d="M190 280 A60 60 0 0 0 310 280" />

        <path className="nba-court-line" d="M220 430H280" />
        <circle className="nba-court-rim" cx="250" cy="417.5" r="7.5" />
        <path className="nba-court-line" d="M210 417.5 A40 40 0 0 1 290 417.5" />

      </svg>
    </div>
  );
}

function RoomRoute() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? "").toUpperCase();
  if (!code) return <Navigate to="/" replace />;
  return <RoomClient roomCode={code} />;
}

export function App() {
  return (
    <>
      <BasketballCourtBackground />
      <div className="app-content">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/catalog" element={<CatalogInspector />} />
          <Route path="/daily" element={<DailyChallenge />} />
          <Route path="/solo" element={<SoloClient />} />
          <Route path="/rooms/:code" element={<RoomRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </>
  );
}
