import type { Metadata } from "next";
import { Inter, Noto_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { UpdateWatcher } from "@/components/update-watcher";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const arabic = Noto_Sans_Arabic({ subsets: ["arabic"], variable: "--font-arabic", weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "Azyaa Admin",
  description: "Azyaa admin panel",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${arabic.variable} antialiased`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
        <UpdateWatcher />
      </body>
    </html>
  );
}
