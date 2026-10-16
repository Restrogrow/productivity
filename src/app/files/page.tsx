"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/lib/useUser";
import { formatBytes, MAX_ATTACHMENT_BYTES } from "@/lib/attachments";
import type { Team, TeamFile } from "@/lib/types";

const BUCKET = "team-files";

const EXPIRY_OPTIONS = [
  { label: "Never expires", hours: 0 },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
];

function fileIcon(mime: string | null, name: string) {
  if (mime?.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "📕";
  if (mime?.startsWith("video/")) return "🎬";
  if (mime?.startsWith("audio/")) return "🎵";
  if (/\.(xlsx?|csv)$/i.test(name)) return "📊";
  if (/\.(docx?|txt|md)$/i.test(name)) return "📄";
  if (/\.(pptx?|key)$/i.test(name)) return "📽️";
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return "🗜️";
  return "📎";
}

function expiryFromNow(hours: number) {
  return hours ? new Date(Date.now() + hours * 3600 * 1000).toISOString() : null;
}

function isActiveShare(f: TeamFile) {
  return !!f.share_token && (!f.share_expires_at || new Date(f.share_expires_at) > new Date());
}

export default function FilesPage() {
  const user = useUser();
  const [team, setTeam] = useState<Team | null>(null);
  const [files, setFiles] = useState<TeamFile[]>([]);
  const [uploaders, setUploaders] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [sharing, setSharing] = useState<string | null>(null); // file id with the share panel open
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Resolve the active team, then load its files and who uploaded them.
  useEffect(() => {
    if (!user) return;
    let stale = false;
    void (async () => {
      const { data: teams, error: teamsError } = await supabase.from("teams").select("*").order("created_at");
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
      const [{ data: fileRows, error: filesError }, { data: members }] = await Promise.all([
        supabase.from("team_files").select("*").eq("team_id", activeTeam.id).order("created_at", { ascending: false }),
        supabase.from("team_members").select("user_id, profiles(email, full_name)").eq("team_id", activeTeam.id),
      ]);
      if (stale) return;
      if (filesError) setError(filesError.message);
      const names: Record<string, string> = {};
      (members as unknown as { user_id: string; profiles: { email: string | null; full_name: string | null } | null }[] | null)?.forEach(
        (m) => (names[m.user_id] = m.profiles?.full_name || m.profiles?.email?.split("@")[0] || "Someone"),
      );
      setUploaders(names);
      setFiles((fileRows as TeamFile[]) ?? []);
      setTeam(activeTeam);
      setLoading(false);
    })();
    return () => {
      stale = true;
    };
  }, [user]);

  // Live updates from teammates.
  useEffect(() => {
    if (!team) return;
    const channel = supabase
      .channel(`team-files-${team.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "team_files", filter: `team_id=eq.${team.id}` },
        ({ new: row }) =>
          setFiles((prev) => (prev.some((f) => f.id === row.id) ? prev : [row as TeamFile, ...prev])),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "team_files", filter: `team_id=eq.${team.id}` },
        ({ new: row }) => setFiles((prev) => prev.map((f) => (f.id === row.id ? (row as TeamFile) : f))),
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "team_files" }, ({ old }) =>
        setFiles((prev) => prev.filter((f) => f.id !== old.id)),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [team]);

  const uploadFiles = useCallback(
    async (list: FileList | File[]) => {
      if (!team) return;
      setError(null);
      for (const file of Array.from(list)) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setError(`${file.name} is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
          continue;
        }
        setUploading((n) => n + 1);
        const path = `${team.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
        const { error: upError } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { contentType: file.type || undefined });
        if (upError) {
          setError(upError.message);
        } else {
          const { data, error: insError } = await supabase
            .from("team_files")
            .insert({
              team_id: team.id,
              name: file.name,
              size: file.size,
              mime_type: file.type || null,
              storage_path: path,
            })
            .select()
            .single();
          if (insError || !data) {
            setError(insError?.message ?? "Upload failed");
            await supabase.storage.from(BUCKET).remove([path]);
          } else {
            setFiles((prev) => (prev.some((f) => f.id === data.id) ? prev : [data as TeamFile, ...prev]));
          }
        }
        setUploading((n) => n - 1);
      }
      if (inputRef.current) inputRef.current.value = "";
    },
    [team],
  );

  async function openFile(f: TeamFile, download: boolean) {
    const { data, error: urlError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(f.storage_path, 60 * 10, download ? { download: f.name } : undefined);
    if (urlError || !data) return setError(urlError?.message ?? "Could not open the file.");
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function enableShare(f: TeamFile, hours: number) {
    const token = f.share_token ?? crypto.randomUUID().replace(/-/g, "");
    const expires = expiryFromNow(hours);
    const { data, error: updError } = await supabase
      .from("team_files")
      .update({ share_token: token, share_expires_at: expires })
      .eq("id", f.id)
      .select()
      .single();
    if (updError || !data) return setError(updError?.message ?? "Could not create the link.");
    setFiles((prev) => prev.map((x) => (x.id === f.id ? (data as TeamFile) : x)));
    await copyLink(data as TeamFile);
  }

  async function stopShare(f: TeamFile) {
    setFiles((prev) => prev.map((x) => (x.id === f.id ? { ...x, share_token: null, share_expires_at: null } : x)));
    const { error: updError } = await supabase
      .from("team_files")
      .update({ share_token: null, share_expires_at: null })
      .eq("id", f.id);
    if (updError) setError(updError.message);
    setSharing(null);
  }

  async function copyLink(f: TeamFile) {
    if (!f.share_token) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/s/${f.share_token}`);
      setCopied(f.id);
      setTimeout(() => setCopied((c) => (c === f.id ? null : c)), 2000);
    } catch {
      setError("Could not copy automatically. Select the link and copy it manually.");
    }
  }

  async function deleteFile(f: TeamFile) {
    setFiles((prev) => prev.filter((x) => x.id !== f.id));
    setConfirmDelete(null);
    const { error: delError } = await supabase.from("team_files").delete().eq("id", f.id);
    if (delError) return setError(delError.message);
    // Drop task attachments that pointed at this library file.
    await supabase.from("task_attachments").delete().eq("bucket", BUCKET).eq("storage_path", f.storage_path);
    await supabase.storage.from(BUCKET).remove([f.storage_path]);
  }

  if (!user) return null;

  const visible = files.filter((f) => f.name.toLowerCase().includes(search.trim().toLowerCase()));
  const sharedCount = files.filter(isActiveShare).length;

  return (
    <>
      <Header email={user.email} user={user} />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
        <section className="card p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium text-indigo-600">Shared library</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Files</h1>
              <p className="mt-1.5 max-w-xl text-sm text-slate-500 sm:text-base">
                Keep your important docs in one place. Share any file with a link, even with people who do not have an
                account.
              </p>
            </div>
            <button onClick={() => inputRef.current?.click()} className="btn-primary shrink-0" disabled={!team}>
              {uploading > 0 ? "Uploading…" : "+ Upload files"}
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => e.target.files && void uploadFiles(e.target.files)}
            />
          </div>

          <div
            className={`mt-6 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm transition ${
              dragOver ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-400"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void uploadFiles(e.dataTransfer.files);
            }}
          >
            Drag and drop files here (max {formatBytes(MAX_ATTACHMENT_BYTES)} each)
          </div>

          {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-500">
              {files.length} {files.length === 1 ? "file" : "files"} · {sharedCount} shared by link
            </p>
            <input
              className="input w-full sm:w-64"
              placeholder="Search files…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="mt-6 flex justify-center py-10">
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
            </div>
          ) : visible.length === 0 ? (
            <p className="mt-6 py-10 text-center text-sm text-slate-400">
              {files.length === 0 ? "No files yet. Upload your first one above." : "No files match your search."}
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {visible.map((f) => {
                const shared = isActiveShare(f);
                return (
                  <li key={f.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-2xl">{fileIcon(f.mime_type, f.name)}</span>
                      <div className="min-w-0 flex-1">
                        <button
                          onClick={() => void openFile(f, false)}
                          className="block max-w-full truncate text-left text-sm font-medium text-slate-800 hover:text-indigo-700"
                        >
                          {f.name}
                        </button>
                        <p className="text-xs text-slate-400">
                          {formatBytes(f.size)} · {(f.created_by && uploaders[f.created_by]) || "Someone"} ·{" "}
                          {new Date(f.created_at).toLocaleDateString()}
                          {shared && <span className="ml-2 font-medium text-emerald-600">● Shared</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 text-sm">
                        <button onClick={() => void openFile(f, true)} className="btn-secondary px-2.5 py-1 text-xs">
                          Download
                        </button>
                        <button
                          onClick={() => setSharing(sharing === f.id ? null : f.id)}
                          className="btn-secondary px-2.5 py-1 text-xs"
                        >
                          🔗 Share
                        </button>
                        <button
                          onClick={() => (confirmDelete === f.id ? void deleteFile(f) : setConfirmDelete(f.id))}
                          onBlur={() => setConfirmDelete(null)}
                          className={`px-2 py-1 text-xs ${confirmDelete === f.id ? "font-medium text-red-600" : "text-slate-400 hover:text-red-600"}`}
                        >
                          {confirmDelete === f.id ? "Delete?" : "✕"}
                        </button>
                      </div>
                    </div>

                    {sharing === f.id && (
                      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                        {shared ? (
                          <div className="space-y-2">
                            <p className="text-xs text-slate-500">
                              Anyone with this link can view and download the file
                              {f.share_expires_at
                                ? `, until ${new Date(f.share_expires_at).toLocaleString()}`
                                : ", with no expiry"}
                              .
                            </p>
                            <div className="flex gap-2">
                              <input
                                readOnly
                                className="input py-1.5 text-xs"
                                value={`${typeof window !== "undefined" ? window.location.origin : ""}/s/${f.share_token}`}
                                onFocus={(e) => e.currentTarget.select()}
                              />
                              <button onClick={() => void copyLink(f)} className="btn-primary shrink-0 px-3 py-1.5 text-xs">
                                {copied === f.id ? "Copied!" : "Copy link"}
                              </button>
                            </div>
                            <button
                              onClick={() => void stopShare(f)}
                              className="text-xs font-medium text-red-600 hover:text-red-700"
                            >
                              Stop sharing
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs text-slate-500">Create a link anyone can open, no sign-in needed.</p>
                            <div className="flex flex-wrap gap-2">
                              {EXPIRY_OPTIONS.map((o) => (
                                <button
                                  key={o.hours}
                                  onClick={() => void enableShare(f, o.hours)}
                                  className="btn-secondary px-3 py-1.5 text-xs"
                                >
                                  {o.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
