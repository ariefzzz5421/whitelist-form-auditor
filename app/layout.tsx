import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Whitelist Form Auditor",
  description: "Verify whether dummy whitelist data is sent from a website form to a server.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
