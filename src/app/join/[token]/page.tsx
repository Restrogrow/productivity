"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/lib/useUser";
import Link from "next/link";

function Spinner({ label }: { label: string }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-20 text-center">
      <div className="card flex items-center justify-center p-10">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
        <p className="ml-3 text-sm text-slate-500">{label}</p>
      </div>
    </main>
  );
}

function JoinTeamInner() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const user = useUser();
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!token) return;
    // Always remember the invite first so it can be consumed after sign-in —
    // useUser redirects anonymous visitors to /login.
    localStorage.setItem("pendingInvite", token);
  }, [token]);

  useEffect(() => {
    if (!token || !user || startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      const { error: rpcError } = await supabase.rpc("join_team_by_token", { invite_token: token });
      localStorage.removeItem("pendingInvite");
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      router.replace("/dashboard");
    })();
  }, [token, user, router]);

  if (error) {
    return (
      <>
        <Header />
        <main className="mx-auto max-w-xl px-4 py-20 text-center">
          <div className="card p-8">
            <div className="text-3xl">🔗</div>
            <h1 className="mt-3 text-lg font-semibold text-slate-900">Invite link problem</h1>
            <p className="mt-2 text-sm text-slate-500">{error}</p>
            <Link href="/dashboard" className="btn-primary mt-6">Go to dashboard</Link>
          </div>
        </main>
      </>
    );
  }

  return <Spinner label="Joining the team…" />;
}

// Suspense boundary so `useParams` doesn't block the static prerender.
export default function JoinTeamPage() {
  return (
    <>
      <Header />
      <Suspense fallback={<Spinner label="Loading invite…" />}>
        <JoinTeamInner />
      </Suspense>
    </>
  );
}
