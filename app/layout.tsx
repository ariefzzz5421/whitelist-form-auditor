import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Whitelist / Waitlist Submission Detector",
  description: "Chrome Extension companion for YES/NO dummy form submission detection.",
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
