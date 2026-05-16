import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const jbMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "groundwork — affordable housing across six U.S. cities",
  description:
    "Interactive map of ~6,500 affordable-housing projects across NYC, SF, LA, DC, Chicago, and Philadelphia. Compare cities, see rent-burden by tract, find underserved neighborhoods, chart production over time, and measure each city against its own published housing target.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jbMono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
