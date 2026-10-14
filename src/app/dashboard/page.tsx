"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/lib/useUser";
import type { Team } from "@/lib/types";

export default function DashboardPage() {
  const user = useUser();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("teams").select("*").order("created_at");
    if (error) setError(error.message);
    setTeams(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // load() only sets state after its awaits resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) load();
  }, [user, load]);

  async function createTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const { error } = await supabase.rpc("create_team", { team_name: name.trim() });
    if (error) return setError(error.message);
    setName("");
    load();
  }

  if (!user) return null;

  return (
    <>
      <Header email={user.email} />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-semibold">Your teams</h1>

        <form onSubmit={createTeam} className="mt-6 flex gap-2">
          <input
            className="input"
            placeholder="New team name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn-primary whitespace-nowrap">Create team</button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {teams.map((team) => (
            <Link key={team.id} href={`/team/${team.id}`} className="card p-5 hover:border-indigo-300">
              <h2 className="font-medium">{team.name}</h2>
              <p className="mt-1 text-xs text-slate-500">
                Created {new Date(team.created_at).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>

        {!loading && teams.length === 0 && (
          <p className="mt-6 text-sm text-slate-500">
            No teams yet. Create one above, or ask a teammate to add you by email.
          </p>
        )}
      </main>
    </>
  );
}
