import { LandingPage } from "@/components/landing-page";

export default async function HomePage({
  searchParams
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const params = await searchParams;
  return <LandingPage initialMessage={params.message ?? null} />;
}
