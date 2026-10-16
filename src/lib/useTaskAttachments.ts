"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import { removeFile, uploadAttachment } from "./attachments";
import type { TaskAttachment, TeamFile } from "./types";

/** Attachments for every task of a team, kept live via realtime. */
export function useTaskAttachments(teamId: string | null) {
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);

  useEffect(() => {
    if (!teamId) return;
    let mounted = true;
    void supabase
      .from("task_attachments")
      .select("*")
      .eq("team_id", teamId)
      .order("created_at")
      .then(({ data }) => mounted && setAttachments((data as TaskAttachment[]) ?? []));

    const channel = supabase
      .channel(`task-attachments-${teamId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "task_attachments", filter: `team_id=eq.${teamId}` },
        ({ new: row }) =>
          setAttachments((prev) => (prev.some((a) => a.id === row.id) ? prev : [...prev, row as TaskAttachment])),
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "task_attachments" }, ({ old }) =>
        setAttachments((prev) => prev.filter((a) => a.id !== old.id)),
      )
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [teamId]);

  const byTask = useMemo(() => {
    const map = new Map<string, TaskAttachment[]>();
    for (const a of attachments) map.set(a.task_id, [...(map.get(a.task_id) ?? []), a]);
    return map;
  }, [attachments]);

  /** Returns an error message, or null on success. */
  const upload = useCallback(
    async (taskId: string, file: File): Promise<string | null> => {
      if (!teamId) return "No team";
      const res = await uploadAttachment(teamId, `tasks/${taskId}`, file);
      if (res.error !== undefined) return res.error;
      const { data, error } = await supabase
        .from("task_attachments")
        .insert({
          team_id: teamId,
          task_id: taskId,
          name: file.name,
          size: file.size,
          mime_type: file.type || null,
          storage_path: res.path,
        })
        .select()
        .single();
      if (error || !data) {
        await removeFile(res.path);
        return error?.message ?? "Upload failed";
      }
      setAttachments((prev) => (prev.some((a) => a.id === data.id) ? prev : [...prev, data as TaskAttachment]));
      return null;
    },
    [teamId],
  );

  const remove = useCallback(async (attachment: TaskAttachment) => {
    setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
    await supabase.from("task_attachments").delete().eq("id", attachment.id);
    // Library files are shared with the Files page, so only delete direct uploads.
    if (attachment.bucket === "attachments") await removeFile(attachment.storage_path);
  }, []);

  /** Attach an existing library file to a task. Returns an error message, or null. */
  const linkFile = useCallback(
    async (taskId: string, file: TeamFile): Promise<string | null> => {
      if (!teamId) return "No team";
      const { data, error } = await supabase
        .from("task_attachments")
        .insert({
          team_id: teamId,
          task_id: taskId,
          name: file.name,
          size: file.size,
          mime_type: file.mime_type,
          storage_path: file.storage_path,
          bucket: "team-files",
        })
        .select()
        .single();
      if (error || !data) return error?.message ?? "Could not attach the file";
      setAttachments((prev) => (prev.some((a) => a.id === data.id) ? prev : [...prev, data as TaskAttachment]));
      return null;
    },
    [teamId],
  );

  return { byTask, upload, remove, linkFile };
}
