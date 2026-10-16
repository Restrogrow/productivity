"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatBytes, signedUrl } from "@/lib/attachments";
import type { Column, Priority, Task, TaskAttachment, TaskExtras, TeamFile, TeamMember } from "@/lib/types";
import Reactions from "./Reactions";

type Props = {
  task: Task;
  columns: Column[];
  members: TeamMember[];
  onClose: () => void;
  onSave: (changes: Partial<Task>) => void;
  onDelete: () => void;
  extras?: TaskExtras;
  /** Resolves to an error message, or null on success. */
  onUpload?: (taskId: string, file: File) => Promise<string | null>;
  onRemoveAttachment?: (attachment: TaskAttachment) => void;
  teamId?: string | null;
  onLinkFile?: (taskId: string, file: TeamFile) => Promise<string | null>;
};

export default function TaskModal({ task, columns, members, onClose, onSave, onDelete, extras, onUpload, onRemoveAttachment, teamId, onLinkFile }: Props) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [columnId, setColumnId] = useState(task.column_id);
  const [assigneeId, setAssigneeId] = useState(task.assignee_id ?? "");
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachments = extras?.attachments.get(task.id) ?? [];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [library, setLibrary] = useState<TeamFile[] | null>(null);

  // Load the shared library the first time the picker is opened.
  useEffect(() => {
    if (!pickerOpen || library || !teamId) return;
    let mounted = true;
    void supabase
      .from("team_files")
      .select("*")
      .eq("team_id", teamId)
      .order("created_at", { ascending: false })
      .then(({ data }) => mounted && setLibrary((data as TeamFile[]) ?? []));
    return () => {
      mounted = false;
    };
  }, [pickerOpen, library, teamId]);

  async function linkLibraryFile(file: TeamFile) {
    const err = await onLinkFile?.(task.id, file);
    if (err) setUploadError(err);
    else setPickerOpen(false);
  }

  async function handleFiles(files: FileList | File[]) {
    if (!onUpload) return;
    setUploading(true);
    setUploadError(null);
    for (const file of Array.from(files)) {
      const err = await onUpload(task.id, file);
      if (err) {
        setUploadError(err);
        break;
      }
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function openAttachment(a: TaskAttachment) {
    const url = await signedUrl(a.storage_path, a.bucket);
    if (url) window.open(url, "_blank", "noopener");
    else setUploadError("Could not open that file.");
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      description: description.trim() || null,
      column_id: columnId,
      assignee_id: assigneeId || null,
      due_date: dueDate || null,
      priority,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="card max-h-[90vh] w-full max-w-lg space-y-5 overflow-y-auto p-6 shadow-xl">
        <input
          className="w-full text-lg font-semibold outline-none"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <textarea
          className="input min-h-24"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="space-y-1">
            <span className="text-xs text-slate-500">Status</span>
            <select className="input" value={columnId} onChange={(e) => setColumnId(e.target.value)}>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-500">Assignee</span>
            <select className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.profiles?.full_name || m.profiles?.email}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-500">Due date</span>
            <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-500">Priority</span>
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>

        {extras && (
          <div className="space-y-1.5">
            <span className="text-xs text-slate-500">Reactions</span>
            <Reactions
              reactions={extras.reactions.get(task.id) ?? []}
              userId={extras.userId}
              onToggle={(emoji) => extras.toggleReaction(task.id, emoji)}
            />
          </div>
        )}

        {onUpload && (
          <div
            className={`space-y-2 rounded-xl border-2 border-dashed p-3 transition ${dragOver ? "border-indigo-400 bg-indigo-50" : "border-slate-200"}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void handleFiles(e.dataTransfer.files);
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Attachments{attachments.length > 0 && ` (${attachments.length})`}
              </span>
              <div className="flex items-center gap-3">
                {onLinkFile && teamId && (
                  <button
                    type="button"
                    onClick={() => setPickerOpen((v) => !v)}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    From Files
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                >
                  {uploading ? "Uploading…" : "+ Add file"}
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => e.target.files && void handleFiles(e.target.files)}
              />
            </div>
            {pickerOpen && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                {library === null ? (
                  <p className="p-3 text-xs text-slate-400">Loading…</p>
                ) : library.length === 0 ? (
                  <p className="p-3 text-xs text-slate-400">No files in the library yet. Add some on the Files page.</p>
                ) : (
                  library.map((f) => {
                    const already = attachments.some((a) => a.bucket === "team-files" && a.storage_path === f.storage_path);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        disabled={already}
                        onClick={() => void linkLibraryFile(f)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50 disabled:opacity-40"
                      >
                        <span className="min-w-0 flex-1 truncate">{f.name}</span>
                        <span className="shrink-0 text-xs text-slate-400">{already ? "Attached" : formatBytes(f.size)}</span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
            {attachments.length === 0 && !uploading && (
              <p className="text-xs text-slate-400">Drop files here or click “Add file” (max 10 MB each).</p>
            )}
            <ul className="space-y-1">
              {attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-sm">
                  <span>{a.mime_type?.startsWith("image/") ? "🖼️" : "📄"}</span>
                  <button
                    type="button"
                    onClick={() => void openAttachment(a)}
                    className="min-w-0 flex-1 truncate text-left text-slate-700 hover:text-indigo-700"
                    title="Open"
                  >
                    {a.name}
                  </button>
                  <span className="shrink-0 text-xs text-slate-400">{formatBytes(a.size)}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveAttachment?.(a)}
                    className="shrink-0 text-xs text-slate-400 hover:text-red-600"
                    title="Remove"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          {confirmDelete ? (
            <button type="button" onClick={onDelete} className="text-sm font-medium text-red-600">
              Click again to delete
            </button>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm text-red-600">
              Delete task
            </button>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button className="btn-primary">Save</button>
          </div>
        </div>
      </form>
    </div>
  );
}
