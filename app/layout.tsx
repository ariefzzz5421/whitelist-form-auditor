import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YES / NO Whitelist Form Detector",
  description: "Paste a whitelist or waitlist URL and detect whether dummy data is sent to a server.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
