import type { Metadata } from "next";
import { Be_Vietnam_Pro, JetBrains_Mono, Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-main",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

const beVietnam = Be_Vietnam_Pro({
  variable: "--font-vn",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin", "vietnamese"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  weight: ["400", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Quan Ly Lich Giao Vien",
  description: "He thong Next.js doc Google Sheet de quan ly thong tin va lich giang day giao vien",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body className={`${manrope.variable} ${beVietnam.variable} ${jetBrainsMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
