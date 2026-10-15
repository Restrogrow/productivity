"use client";

import { useCallback, useEffect, useState } from "react";
import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/lib/useUser";
import { createNotification } from "@/lib/useNotifications";
import type { EodUpdate, Team } from "@/lib/types";

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function EodUpdatesPage() {
  const user = useUser();
  const [team, setTeam] = useState<Team | null>(null);
  const [updates, setUpdates] = useState<EodUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Set client-side after mount — `new Date()` is unstable during prerender.
  const [date, setDate] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Refresh the update list for the active team (used after create/delete and realtime events).
  const loadUpdates = useCallback(async (teamId: string) => {
    const { data, error: qErr } = await supabase
      .from("eod_updates")
      .select("*, profiles(email, full_name)")
      .eq("team_id", teamId)
      .order("update_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (qErr) setError(qErr.message);
    setUpdates((data as EodUpdate[]) ?? []);
  }, []);

  useEffect(() => {
    if (!user) return;
    let stale = false;
    void (async () => {
      const { data: teams } = await supabase.from("teams").select("*").order("created_at");
      if (stale) return;
      setDate(todayISO());
      const activeTeam = teams?.[0] ?? null;
      setTeam(activeTeam);
      if (activeTeam) {
        await loadUpdates(activeTeam.id);
        if (stale) return;
      } else {
        setUpdates([]);
      }
      setLoading(false);
    })();
    return () => {
      stale = true;
    };
  }, [user, loadUpdates]);

  // realtime — new or deleted EOD updates appear/disappear live
  useEffect(() => {
    if (!team) return;
    const channel = supabase
      .channel(`eod-${team.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "eod_updates", filter: `team_id=eq.${team.id}` },
        () => loadUpdates(team.id),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "eod_updates", filter: `team_id=eq.${team.id}` },
        () => loadUpdates(team.id),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [team, loadUpdates]);

  async function createUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!team || !user || !content.trim()) return;
    setSaving(true);
    const { error: insertError } = await supabase.from("eod_updates").insert({
      team_id: team.id,
      content: content.trim(),
      update_date: date,
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setContent("");
    setDate(todayISO());

    // Notify teammates so they come read it
    if (team) {
      const { data: teamMembers } = await supabase
        .from("team_members")
        .select("user_id")
        .eq("team_id", team.id);
      for (const m of teamMembers ?? []) {
        if (m.user_id !== user.id) {
          await createNotification(
            m.user_id,
            "eod_update",
            `${user.email?.split("@")[0]} posted an EOD update`,
            `/updates`,
            user.id,
          );
        }
      }
      await loadUpdates(team.id);
    }
  }

  async function deleteUpdate(id: string) {
    if (!confirm("Delete this update?")) return;
    await supabase.from("eod_updates").delete().eq("id", id);
    if (team) await loadUpdates(team.id);
  }

  if (!user) return null;

  return (
    <>
      <Header email={user.email} user={user} />
      <main className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
        <section className="card p-6 sm:p-8">
          <p className="text-sm font-medium text-indigo-600">Daily log</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            EOD Updates
          </h1>
          <p className="mt-2 text-sm text-slate-500 sm:text-base">
            Post your end-of-day update for your team, and catch up on everyone else&apos;s.
          </p>
        </section>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        {/* New update */}
        <form onSubmit={createUpdate} className="card mt-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-slate-600">
              <span className="mb-1 block font-medium">Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input py-2" />
            </label>
            <span className="hidden pb-2 text-xs text-slate-400 sm:block">
              shown as “EOD Update – {date ? formatDate(date) : "today"}”
            </span>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            required
            placeholder={"One bullet per line, e.g.\n- Created 15 new creatives\n- Updated and improved the software demo video"}
            className="input mt-3 min-h-28 resize-y"
          />
          <div className="mt-3 flex justify-end">
            <button type="submit" disabled={saving || !content.trim()} className="btn-primary">
              {saving ? "Posting…" : "Post EOD update"}
            </button>
          </div>
        </form>

        {/* Update list */}
        <div className="mt-6 flex flex-col gap-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-slate-500">Loading updates…</p>
          ) : updates.length === 0 ? (
            <div className="card py-10 text-center">
              <div className="text-3xl">📝</div>
              <p className="mt-2 text-sm text-slate-500">No EOD updates yet. Post the first one above.</p>
            </div>
          ) : (
            updates.map((u) => {
              const lines = u.content.split("\n").filter(Boolean);
              const bullets = lines.map((line) => line.replace(/^[-•*]\s*/, ""));
              const open = expanded.has(u.id);
              const shown = open ? bullets : bullets.slice(0, 3);
              return (
                <article key={u.id} className="card p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">
                        EOD Update – {formatDate(u.update_date)}
                      </h2>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {u.profiles?.email?.split("@")[0] || "Unknown"} ·{" "}
                        {new Date(u.created_at).toLocaleTimeString()}
                      </p>
                    </div>
                    {u.created_by === user.id && (
                      <button
                        onClick={() => deleteUpdate(u.id)}
                        className="rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-700">
                    {shown.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                  {bullets.length > 3 && (
                    <button
                      onClick={() =>
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(u.id)) next.delete(u.id);
                          else next.add(u.id);
                          return next;
                        })
                      }
                      className="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      {open ? "Show less" : `Show all ${bullets.length} points`}
                    </button>
                  )}
                </article>
              );
            })
          )}
        </div>
      </main>
    </>
  );
}
