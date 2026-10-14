"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/lib/useUser";
import type { Whiteboard } from "@/lib/types";

export default function WhiteboardListPage() {
  const user = useUser();
  const router = useRouter();
  const [teamId, setTeamId] = useState<string | null>(null);
  const [boards, setBoards] = useState<Whiteboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: teams } = await supabase.from("teams").select("id").order("created_at");
    let active = teams?.[0]?.id ?? null;
    if (!active) {
      const { data, error } = await supabase.rpc("create_team", { team_name: "Our team" });
      if (error) { setError(error.message); setLoading(false); return; }
      active = (data as { id: string }).id;
    }
    setTeamId(active);
    const { data, error } = await supabase.from("whiteboards").select("*").eq("team_id", active).order("updated_at", { ascending: false });
    if (error) setError(error.message);
    setBoards((data ?? []) as Whiteboard[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  // realtime — live-update the board list as teammates create/rename boards
  useEffect(() => {
    if (!teamId) return;
    const channel = supabase
      .channel(`whiteboard-list-${teamId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whiteboards", filter: `team_id=eq.${teamId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [teamId, load]);

  async function createBoard(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !teamId) return;
    const { data, error } = await supabase.from("whiteboards").insert({ team_id: teamId, name: name.trim() }).select().single();
    if (error) return setError(error.message);
    if (data) router.push(`/whiteboard/${data.id}`);
    else load();
  }

  if (!user) return null;

  return (
    <>
      <Header email={user.email} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:py-10">
        <section className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-md sm:p-8">
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-medium text-indigo-600">Whiteboard</p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Boards</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600 sm:text-base">
                Sketch ideas, diagrams, and plans together.
              </p>
            </div>
            <form onSubmit={createBoard} className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <input className="input min-w-[220px]" placeholder="Board name" value={name} onChange={(e) => setName(e.target.value)} required />
              <button className="btn-primary whitespace-nowrap">New board</button>
            </form>
          </div>
        </section>

        {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        <section className="mt-8">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => <div key={i} className="card h-36 animate-pulse bg-slate-100/70" />)}
            </div>
          ) : boards.length === 0 ? (
            <div className="card flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="text-4xl">🎨</div>
              <h2 className="mt-4 text-lg font-semibold text-slate-900">No whiteboards yet</h2>
              <p className="mt-1 text-sm text-slate-500">Create one to start sketching.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {boards.map((b) => (
                <Link
                  key={b.id}
                  href={`/whiteboard/${b.id}`}
                  className="card group p-5 transition-all hover:-translate-y-1 hover:border-indigo-300 hover:shadow-lg"
                >
                  <h2 className="text-base font-semibold text-slate-900 group-hover:text-indigo-700">{b.name}</h2>
                  <p className="mt-2 text-xs text-slate-400">
                    Updated {new Date(b.updated_at).toLocaleDateString()}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}