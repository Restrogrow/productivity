"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/lib/useUser";
import type { Project, Team } from "@/lib/types";

export default function DashboardPage() {
  const user = useUser();
  const router = useRouter();
  const [team, setTeam] = useState<Team | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: teams, error: teamsError } = await supabase
      .from("teams")
      .select("*")
      .order("created_at");
    if (teamsError) {
      setError(teamsError.message);
      setLoading(false);
      return;
    }
    let activeTeam = teams?.[0] ?? null;
    if (!activeTeam) {
      const { data, error: createError } = await supabase.rpc("create_team", { team_name: "Our team" });
      if (createError) {
        setError(createError.message);
        setLoading(false);
        return;
      }
      activeTeam = data as Team;
    }
    setTeam(activeTeam);

    const { data: projectData, error: projectError } = await supabase
      .from("projects")
      .select("*")
      .eq("team_id", activeTeam.id)
      .order("created_at");
    if (projectError) setError(projectError.message);
    setProjects(projectData ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  // realtime — live-update the project list as teammates create/rename projects
  useEffect(() => {
    if (!team) return;
    const channel = supabase
      .channel(`dashboard-${team.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects", filter: `team_id=eq.${team.id}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [team, load]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !team) return;
    const { data, error } = await supabase
      .from("projects")
      .insert({ team_id: team.id, name: name.trim(), description: description.trim() || null })
      .select()
      .single();
    if (error) return setError(error.message);
    setName("");
    setDescription("");
    setCreateOpen(false);
    if (data) router.push(`/project/${data.id}`);
    else load();
  }

  if (!user) return null;

  const initials = (user.email ?? "?").slice(0, 2).toUpperCase();

  return (
    <>
      <Header email={user.email} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:py-10">
        <section className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-md sm:p-8">
          <div className="absolute -right-24 -top-24 h-56 w-56 rounded-full bg-indigo-200/30 blur-3xl" />
          <div className="absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-sky-200/30 blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-medium text-indigo-600">Shared workspace</p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Projects</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600 sm:text-base">
                Plan, track, and ship work together. {projects.length} {projects.length === 1 ? "project" : "projects"} so far.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-3 rounded-2xl border border-slate-200/70 bg-white/90 p-2 pr-4 shadow-sm sm:flex">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white">
                  {initials}
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{user.email?.split("@")[0]}</p>
                  <p className="text-xs text-slate-500">{projects.length} active projects</p>
                </div>
              </div>
              <button onClick={() => setCreateOpen((v) => !v)} className="btn-primary">
                {createOpen ? "Cancel" : "+ New project"}
              </button>
            </div>
          </div>
        </section>

        {createOpen && (
          <section className="mt-6">
            <form onSubmit={createProject} className="card space-y-3 p-5 sm:p-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  className="input"
                  placeholder="Project name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                />
                <input
                  className="input"
                  placeholder="Description (optional)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3">
                <button className="btn-primary">Create project</button>
                <p className="text-xs text-slate-500">It starts with To Do, In Progress, and Done.</p>
              </div>
            </form>
          </section>
        )}

        {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        <section className="mt-8">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="card h-40 animate-pulse bg-slate-100/70" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="card flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-2xl">📋</div>
              <h2 className="mt-4 text-lg font-semibold text-slate-900">No projects yet</h2>
              <p className="mt-1 text-sm text-slate-500">Create your first project to get started.</p>
              <button onClick={() => setCreateOpen(true)} className="btn-primary mt-5">Create project</button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <Link
                  key={p.id}
                  href={`/project/${p.id}`}
                  className="card group overflow-hidden p-5 transition-all hover:-translate-y-1 hover:border-indigo-300 hover:shadow-lg"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-base font-semibold text-slate-900 group-hover:text-indigo-700">
                      {p.name}
                    </h2>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 transition group-hover:bg-indigo-50 group-hover:text-indigo-700">
                      Open
                    </span>
                  </div>
                  {p.description && <p className="mt-2 line-clamp-2 text-sm text-slate-500">{p.description}</p>}
                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                    <p className="text-xs text-slate-400">
                      {new Date(p.created_at).toLocaleDateString()}
                    </p>
                    <span className="text-xs font-medium text-indigo-600 opacity-0 transition group-hover:opacity-100">
                      View →
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}