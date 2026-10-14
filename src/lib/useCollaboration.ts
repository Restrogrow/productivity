"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type Collaborator = { userId: string; name: string; color: string };
export type RemoteCursor = Collaborator & { x: number; y: number; view: string };

const COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
const CURSOR_INTERVAL_MS = 40;

export function colorFor(userId: string) {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

// Presence (who's online), live cursors, and "who is dragging which card" for one project,
// all over a single Supabase Realtime channel. Nothing here touches the database.
export function useCollaboration(projectId: string, userId: string | undefined, name: string, onSync: () => void) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastCursorSent = useRef(0);
  const onSyncRef = useRef(onSync);
  const [online, setOnline] = useState<Collaborator[]>([]);
  const [cursors, setCursors] = useState<Record<string, RemoteCursor>>({});
  const [dragging, setDragging] = useState<Record<string, Collaborator>>({});

  useEffect(() => {
    onSyncRef.current = onSync;
  }, [onSync]);

  useEffect(() => {
    if (!userId) return;
    const self: Collaborator = { userId, name, color: colorFor(userId) };
    const channel = supabase.channel(`collab-${projectId}`, {
      config: { presence: { key: userId }, broadcast: { self: false } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const people = Object.values(channel.presenceState<Collaborator>())
          .map((entries) => entries[0])
          .filter(Boolean);
        setOnline(people);
        // Forget cursors and drags of anyone who left.
        const ids = new Set(people.map((p) => p.userId));
        setCursors((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => ids.has(id))));
        setDragging((prev) => Object.fromEntries(Object.entries(prev).filter(([, c]) => ids.has(c.userId))));
      })
      .on("broadcast", { event: "cursor" }, ({ payload }) => {
        setCursors((prev) => ({ ...prev, [payload.userId]: payload as RemoteCursor }));
      })
      .on("broadcast", { event: "cursor-leave" }, ({ payload }) => {
        setCursors((prev) => {
          const next = { ...prev };
          delete next[payload.userId];
          return next;
        });
      })
      .on("broadcast", { event: "drag" }, ({ payload }) => {
        setDragging((prev) => {
          const next = Object.fromEntries(Object.entries(prev).filter(([, c]) => c.userId !== payload.userId));
          if (payload.taskId) next[payload.taskId] = payload as Collaborator;
          return next;
        });
      })
      .on("broadcast", { event: "sync" }, () => onSyncRef.current())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") channel.track(self);
      });

    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [projectId, userId, name]);

  const send = useCallback(
    (event: string, payload: Record<string, unknown>) => {
      if (!userId) return;
      channelRef.current?.send({
        type: "broadcast",
        event,
        payload: { userId, name, color: colorFor(userId), ...payload },
      });
    },
    [userId, name],
  );

  const sendCursor = useCallback(
    (x: number, y: number, view: string) => {
      const now = Date.now();
      if (now - lastCursorSent.current < CURSOR_INTERVAL_MS) return;
      lastCursorSent.current = now;
      send("cursor", { x, y, view });
    },
    [send],
  );

  const hideCursor = useCallback(() => send("cursor-leave", {}), [send]);
  const sendDrag = useCallback((taskId: string | null) => send("drag", { taskId }), [send]);
  // Tells teammates to refetch; a fallback alongside database change events.
  const notifyChanged = useCallback(() => send("sync", {}), [send]);

  return { online, cursors, dragging, sendCursor, hideCursor, sendDrag, notifyChanged };
}
