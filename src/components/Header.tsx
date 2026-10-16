"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import NotificationBell from "./NotificationBell";
import type { User } from "@supabase/supabase-js";

export default function Header({ email, user }: { email?: string | null; user?: User | null | undefined }) {
  const router = useRouter();

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white shadow-sm shadow-indigo-600/25">
              P
            </span>
            <span className="text-lg font-bold tracking-tight text-slate-900">Productivy</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            <Link href="/dashboard" className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
              Projects
            </Link>
            <Link href="/whiteboard" className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
              Whiteboard
            </Link>
            <Link href="/screenshare" className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
              Screen Share
            </Link>
            <Link href="/files" className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
              Files
            </Link>
            <Link href="/updates" className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
              EOD Updates
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <NotificationBell user={user ?? null} />
          {email && (
            <span className="hidden rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 sm:inline">
              {email}
            </span>
          )}
          <button onClick={signOut} className="btn-secondary px-3 py-1.5 text-sm">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}