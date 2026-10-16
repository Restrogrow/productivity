"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import type { Reaction } from "./types";

export const REACTION_EMOJIS = ["👍", "❓", "✅", "🎉", "❤️", "👀"];

/**
 * All reactions of one kind ("task" | "message") for a team, kept live via
 * realtime. `toggle` adds or removes the current user's reaction optimistically.
 */
export function useReactions(teamId: string | null, userId: string | undefined, targetType: Reaction["target_type"]) {
  const [reactions, setReactions] = useState<Reaction[]>([]);

  useEffect(() => {
    if (!teamId) return;
    let mounted = true;
    void supabase
      .from("reactions")
      .select("*")
      .eq("team_id", teamId)
      .eq("target_type", targetType)
      .then(({ data }) => mounted && setReactions((data as Reaction[]) ?? []));

    const channel = supabase
      .channel(`reactions-${targetType}-${teamId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "reactions", filter: `team_id=eq.${teamId}` },
        ({ new: row }) => {
          const r = row as Reaction;
          if (r.target_type !== targetType) return;
          setReactions((prev) => (prev.some((x) => x.id === r.id) ? prev : [...prev, r]));
        },
      )
      // DELETE payloads only carry the primary key, so they cannot be filtered by team.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "reactions" }, ({ old }) =>
        setReactions((prev) => prev.filter((r) => r.id !== old.id)),
      )
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [teamId, targetType]);

  const byTarget = useMemo(() => {
    const map = new Map<string, Reaction[]>();
    for (const r of reactions) map.set(r.target_id, [...(map.get(r.target_id) ?? []), r]);
    return map;
  }, [reactions]);

  const toggle = useCallback(
    async (targetId: string, emoji: string) => {
      if (!teamId || !userId) return;
      const mine = reactions.find((r) => r.target_id === targetId && r.emoji === emoji && r.user_id === userId);
      if (mine) {
        setReactions((prev) => prev.filter((r) => r.id !== mine.id));
        const { error } = await supabase.from("reactions").delete().eq("id", mine.id);
        if (error) setReactions((prev) => [...prev, mine]);
      } else {
        const temp: Reaction = {
          id: `temp-${targetId}-${emoji}`,
          team_id: teamId,
          target_type: targetType,
          target_id: targetId,
          emoji,
          user_id: userId,
          created_at: new Date().toISOString(),
        };
        setReactions((prev) => [...prev, temp]);
        const { data, error } = await supabase
          .from("reactions")
          .insert({ team_id: teamId, target_type: targetType, target_id: targetId, emoji })
          .select()
          .single();
        // Swap the temp row for the real one (the realtime echo is de-duplicated by id).
        setReactions((prev) => {
          const without = prev.filter((r) => r.id !== temp.id);
          if (error || !data) return without;
          return without.some((r) => r.id === data.id) ? without : [...without, data as Reaction];
        });
      }
    },
    [teamId, userId, targetType, reactions],
  );

  return { byTarget, toggle };
}
