"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ScreenShare from "@/components/ScreenShare";

export default function WatchPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-100">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
        </div>
      }
    >
      <WatchRoom />
    </Suspense>
  );
}

function WatchRoom() {
  const { roomId } = useParams<{ roomId: string }>();

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            <span className="text-sm font-semibold text-slate-900">Live stream</span>
          </div>
          <Link href="/" className="text-sm text-indigo-600 hover:text-indigo-700">
            ← Back to Productivy
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <section className="card p-6 sm:p-8">
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-indigo-600">Watching as a guest</p>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Live screens
            </h1>
            <p className="max-w-2xl text-sm text-slate-500 sm:text-base">
              Live screen streams appear here automatically — no sign-in needed. Sharers go live in
              real time and you see them the moment they start.
            </p>
          </div>

          <div className="mt-6">
            {/* No userId/userName → ScreenShare generates a per-mount guest identity. */}
            <ScreenShare variant="panel" roomId={roomId} />
          </div>
        </section>
      </main>
    </div>
  );
}
