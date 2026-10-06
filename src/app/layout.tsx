import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RailYatra — Your next stop starts here",
  description:
    "Find a train, compare sample fares, and book a demo railway journey with RailYatra.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
