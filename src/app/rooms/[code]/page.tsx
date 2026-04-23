import { RoomClient } from "@/components/room-client";

export default async function RoomPage({
  params
}: {
  params: Promise<{ code: string }>;
}) {
  const resolvedParams = await params;
  return <RoomClient roomCode={resolvedParams.code.toUpperCase()} />;
}
