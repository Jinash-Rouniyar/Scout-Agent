import type { Metadata } from "next";
import Link from "next/link";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Scout — Founder Diligence",
  description: "Thesis-first founder discovery and continuous diligence.",
};

const navLink =
  "rounded-full px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen flex flex-col`}>
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
            <Link href="/" className="text-base font-semibold tracking-tight text-slate-900 md:text-lg">
              Scout
            </Link>
            <nav className="flex items-center gap-1 text-xs">
              <Link href="/" className={navLink}>
                New run
              </Link>
              <Link href="/runs/run_demo_thesis" className={navLink}>
                Demo run
              </Link>
              <Link href="/watchlist" className={navLink}>
                Watchlist
              </Link>
              <Link href="/evals" className={navLink}>
                Evaluation
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">
          <div className="mx-auto max-w-5xl px-4 py-10 md:px-6">{children}</div>
        </main>
      </body>
    </html>
  );
}
