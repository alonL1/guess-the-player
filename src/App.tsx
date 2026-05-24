import { Navigate, Route, Routes, useParams } from "react-router-dom";

import { LandingPage } from "@/components/LandingPage";
import { RoomClient } from "@/components/RoomClient";
import { SoloClient } from "@/components/SoloClient";

function RoomRoute() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? "").toUpperCase();
  if (!code) return <Navigate to="/" replace />;
  return <RoomClient roomCode={code} />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/solo" element={<SoloClient />} />
      <Route path="/rooms/:code" element={<RoomRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
