import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scout — Founder Diligence",
  description: "Evidence-backed, entity-first founder discovery and continuous diligence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-border bg-panel/60 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
              <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-accent" />
                Scout
              </Link>
              <nav className="flex items-center gap-5 text-sm text-muted">
                <Link href="/" className="hover:text-text">New run</Link>
                <Link href="/watchlist" className="hover:text-text">Watchlist</Link>
                <Link href="/evals" className="hover:text-text">Evaluation</Link>
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
