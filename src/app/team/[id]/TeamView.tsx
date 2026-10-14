"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/lib/useUser";
import type { Project, Team, TeamMember } from "@/lib/types";

export default function TeamView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const user = useUser();
  const [team, setTeam] = useState<Team | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [projectName, setProjectName] = useState("");
  const [projectDesc, setProjectDesc] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, p, m] = await Promise.all([
      supabase.from("teams").select("*").eq("id", id).single(),
      supabase.from("projects").select("*").eq("team_id", id).order("created_at"),
      supabase.from("team_members").select("user_id, role, profiles(id, email, full_name)").eq("team_id", id),
    ]);
    if (t.error) {
      setError("Team not found or you don't have access.");
      return;
    }
    setTeam(t.data);
    setProjects(p.data ?? []);
    setMembers((m.data as unknown as TeamMember[]) ?? []);
  }, [id]);

  useEffect(() => {
    // load() only sets state after its awaits resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) load();
  }, [user, load]);

  const isOwner = members.some((m) => m.user_id === user?.id && m.role === "owner");

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!projectName.trim()) return;
    const { data, error } = await supabase
      .from("projects")
      .insert({ team_id: id, name: projectName.trim(), description: projectDesc.trim() || null })
      .select()
      .single();
    if (error) return setError(error.message);
    router.push(`/project/${data.id}`);
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.rpc("add_team_member", { t: id, member_email: memberEmail });
    if (error) return setError(error.message);
    setMemberEmail("");
    load();
  }

  async function removeMember(userId: string) {
    const { error } = await supabase.from("team_members").delete().eq("team_id", id).eq("user_id", userId);
    if (error) return setError(error.message);
    if (userId === user?.id) router.replace("/dashboard");
    else load();
  }

  if (!user) return null;

  return (
    <>
      <Header email={user.email} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-800">
          ← All teams
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{team?.name ?? "…"}</h1>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <div className="mt-6 grid gap-8 lg:grid-cols-3">
          <section className="lg:col-span-2">
            <h2 className="font-medium">Projects</h2>
            <form onSubmit={createProject} className="card mt-3 space-y-2 p-4">
              <input
                className="input"
                placeholder="Project name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
              <input
                className="input"
                placeholder="Description (optional)"
                value={projectDesc}
                onChange={(e) => setProjectDesc(e.target.value)}
              />
              <button className="btn-primary">Create project</button>
            </form>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {projects.map((p) => (
                <Link key={p.id} href={`/project/${p.id}`} className="card p-4 hover:border-indigo-300">
                  <h3 className="font-medium">{p.name}</h3>
                  {p.description && <p className="mt-1 text-sm text-slate-500">{p.description}</p>}
                </Link>
              ))}
              {projects.length === 0 && <p className="text-sm text-slate-500">No projects yet.</p>}
            </div>
          </section>

          <section>
            <h2 className="font-medium">Members</h2>
            <ul className="card mt-3 divide-y divide-slate-100">
              {members.map((m) => (
                <li key={m.user_id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium">{m.profiles?.full_name ?? "Unknown"}</p>
                    <p className="text-xs text-slate-500">
                      {m.profiles?.email} · {m.role}
                    </p>
                  </div>
                  {(isOwner && m.role !== "owner") || (m.user_id === user.id && m.role !== "owner") ? (
                    <button
                      onClick={() => removeMember(m.user_id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      {m.user_id === user.id ? "Leave" : "Remove"}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>

            {isOwner && (
              <form onSubmit={addMember} className="mt-3 space-y-2">
                <input
                  className="input"
                  type="email"
                  placeholder="teammate@email.com"
                  value={memberEmail}
                  onChange={(e) => setMemberEmail(e.target.value)}
                  required
                />
                <button className="btn-secondary w-full">Add member</button>
                <p className="text-xs text-slate-500">They need to sign up first.</p>
              </form>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
