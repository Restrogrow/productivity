"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function Header({ email }: { email?: string | null }) {
  const router = useRouter();

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link href="/dashboard" className="text-lg font-semibold text-slate-900">
          Productivy
        </Link>
        <div className="flex items-center gap-4 text-sm text-slate-600">
          {email && <span className="hidden sm:inline">{email}</span>}
          <button onClick={signOut} className="rounded-md px-3 py-1.5 hover:bg-slate-100">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
