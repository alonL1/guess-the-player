import type { Metadata } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Guess The Player",
  description: "Realtime NFL player guessing battles."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
