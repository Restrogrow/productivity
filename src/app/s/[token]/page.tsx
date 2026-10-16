"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatBytes } from "@/lib/attachments";

type Shared = {
  name: string;
  size: number;
  mime_type: string | null;
  storage_path: string;
  shared_by: string | null;
  created_at: string;
  share_expires_at: string | null;
};

type State =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; file: Shared; viewUrl: string; downloadUrl: string };

/** Public page for a shared file link. No sign-in required. */
export default function SharedFilePage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!token) return;
    let stale = false;
    void (async () => {
      const { data } = await supabase.rpc("get_shared_file", { t: token });
      const file = (data as Shared[] | null)?.[0];
      if (!file) return !stale && setState({ status: "missing" });
      const bucket = supabase.storage.from("team-files");
      const [view, download] = await Promise.all([
        bucket.createSignedUrl(file.storage_path, 60 * 60),
        bucket.createSignedUrl(file.storage_path, 60 * 60, { download: file.name }),
      ]);
      if (stale) return;
      if (!view.data || !download.data) return setState({ status: "missing" });
      setState({ status: "ready", file, viewUrl: view.data.signedUrl, downloadUrl: download.data.signedUrl });
    })();
    return () => {
      stale = true;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <span className="text-sm font-bold tracking-tight text-slate-900">Productivy</span>
          <Link href="/" className="text-sm text-indigo-600 hover:text-indigo-700">
            Open Productivy →
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        {state.status === "loading" && (
          <div className="flex justify-center py-20">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
          </div>
        )}

        {state.status === "missing" && (
          <div className="card px-6 py-16 text-center">
            <p className="text-4xl">🔒</p>
            <h1 className="mt-3 text-lg font-semibold text-slate-900">This link is not available</h1>
            <p className="mt-1 text-sm text-slate-500">It may have expired, or the owner stopped sharing the file.</p>
          </div>
        )}

        {state.status === "ready" && <FileView {...state} />}
      </main>
    </div>
  );
}

function FileView({ file, viewUrl, downloadUrl }: { file: Shared; viewUrl: string; downloadUrl: string }) {
  const mime = file.mime_type ?? "";
  const isImage = mime.startsWith("image/");
  const isPdf = mime === "application/pdf";
  const isVideo = mime.startsWith("video/");
  const isAudio = mime.startsWith("audio/");

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-slate-900">{file.name}</h1>
          <p className="text-xs text-slate-500">
            {formatBytes(file.size)}
            {file.shared_by && ` · shared by ${file.shared_by}`}
            {file.share_expires_at && ` · link expires ${new Date(file.share_expires_at).toLocaleString()}`}
          </p>
        </div>
        <a href={downloadUrl} className="btn-primary shrink-0">
          Download
        </a>
      </div>

      <div className="bg-slate-50 p-4">
        {isImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={viewUrl} alt={file.name} className="mx-auto max-h-[70vh] rounded-lg object-contain" />
        )}
        {isPdf && <iframe src={viewUrl} title={file.name} className="h-[70vh] w-full rounded-lg bg-white" />}
        {isVideo && <video src={viewUrl} controls className="mx-auto max-h-[70vh] w-full rounded-lg bg-black" />}
        {isAudio && <audio src={viewUrl} controls className="w-full" />}
        {!isImage && !isPdf && !isVideo && !isAudio && (
          <p className="py-10 text-center text-sm text-slate-500">
            No preview for this file type. Use the Download button to get it.
          </p>
        )}
      </div>
    </div>
  );
}
