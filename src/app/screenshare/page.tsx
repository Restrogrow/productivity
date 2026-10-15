"use client";

import { useCallback, useEffect, useState } from "react";
import Header from "@/components/Header";
import ScreenShare from "@/components/ScreenShare";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/lib/useUser";
import { createNotification } from "@/lib/useNotifications";
import type { Team } from "@/lib/types";

export default function ScreenSharePage() {
  const user = useUser();
  // Unique identity per tab/window so the same user can open share in one
  // window and watch in another.
  const [tabSuffix] = useState(() => Math.random().toString(36).slice(2));
  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let stale = false;
    void (async () => {
      const { data: teams, error: teamsError } = await supabase
        .from("teams")
        .select("*")
        .order("created_at");
      if (stale) return;
      if (teamsError) {
        setError(teamsError.message);
        setLoading(false);
        return;
      }
      let activeTeam = teams?.[0] ?? null;
      if (!activeTeam) {
        const { data, error: createError } = await supabase.rpc("create_team", { team_name: "Our team" });
        if (stale) return;
        if (createError) {
          setError(createError.message);
          setLoading(false);
          return;
        }
        activeTeam = data as Team;
      }
      if (!stale) {
        setTeam(activeTeam);
        setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [user]);

  // notify teammates when sharing starts so they can join and watch
  const notifyScreenShare = useCallback(async () => {
    if (!team || !user?.id) return;
    const { data: teamMembers } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("team_id", team.id);
    for (const m of teamMembers ?? []) {
      if (m.user_id !== user.id) {
        await createNotification(
          m.user_id,
          "screen_share",
          `${user.email?.split("@")[0]} started sharing their screen`,
          `/screenshare`,
          user.id,
        );
      }
    }
  }, [team, user]);

  if (!user) return null;

  return (
    <>
      <Header email={user.email} user={user} />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
        <section className="card p-6 sm:p-8">
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-indigo-600">Live with your team</p>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Screen Share
            </h1>
            <p className="max-w-2xl text-sm text-slate-500 sm:text-base">
              Share your screen with your team, or watch anyone who is already streaming. Streams
              connect directly between teammates in real time.
            </p>
          </div>

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          {loading ? (
            <div className="mt-8 flex items-center justify-center py-16">
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
            </div>
          ) : (
            team && (
              <div className="mt-6">
                <ScreenShare
                  variant="panel"
                  roomId={team.id}
                  userId={user ? `${user.id}-${tabSuffix}` : ""}
                  userName={user.email?.split("@")[0] || "Someone"}
                  onShareStart={notifyScreenShare}
                />
              </div>
            )
          )}
        </section>
      </main>
    </>
  );
}
