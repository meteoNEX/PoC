import type { Metadata } from "next";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import * as Sentry from "@sentry/nextjs";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

const sans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-sans",
});

export function generateMetadata(): Metadata {
  return {
    title: "Sentry observability PoC",
    description:
      "Manual validation dashboard for Sentry as an application-observability platform.",
    other: {
      ...Sentry.getTraceData(),
    },
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
