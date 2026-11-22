import type { Metadata } from "next";
import { Inter, Noto_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const arabic = Noto_Sans_Arabic({ subsets: ["arabic"], variable: "--font-arabic", weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "Azyaa Admin",
  description: "Azyaa admin panel",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The theme class and the lang/dir attributes are set in the browser before paint, hence suppressHydrationWarning.
    <html lang="en" className={`${inter.variable} ${arabic.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full bg-background font-sans text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
