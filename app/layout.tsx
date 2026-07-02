import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Whitelist Form Auditor",
  description: "Audit whitelist forms for backend submission and local storage behavior.",
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
