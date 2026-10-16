"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatBytes, removeFile, signedUrl, uploadAttachment } from "@/lib/attachments";
import { useReactions } from "@/lib/useReactions";
import type { Profile } from "@/lib/types";
import Reactions from "./Reactions";

type ChatMessage = {
  id: string;
  room: string;
  content: string;
  created_at: string;
  created_by: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  profiles: Profile | null;
};

export default function ChatPanel({
  room,
  teamId,
  userId,
}: {
  room: string;
  teamId: string | null;
  userId: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState("");
  const openRef = useRef(open);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const messageReactions = useReactions(teamId, userId, "message");

  useEffect(() => {
    let mounted = true;

    void (async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("*, profiles(email, full_name)")
        .eq("room", room)
        .order("created_at", { ascending: true })
        .limit(50);
      if (!mounted) return;
      setMessages((data as ChatMessage[]) ?? []);
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
    })();

    const channel = supabase
      .channel(`chat-${room}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `room=eq.${room}` },
        ({ new: row }) => {
          void (async () => {
            // Fetch the row joined with author info (realtime payloads have no joins).
            const { data: full } = await supabase
              .from("chat_messages")
              .select("*, profiles(email, full_name)")
              .eq("id", row.id)
              .single();
            if (!full || !mounted) return;
            setMessages((prev) => (prev.some((m) => m.id === full.id) ? prev : [...prev, full as ChatMessage]));
            if (!openRef.current) setUnread((u) => u + 1);
            requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
          })();
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [room]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if ((!draft.trim() && !file) || !userId || !teamId || sending) return;
    const content = draft.trim();
    const pending = file;
    setSending(true);
    setSendError(null);

    let attachment: { attachment_path: string; attachment_name: string; attachment_type: string | null } | null = null;
    if (pending) {
      const res = await uploadAttachment(teamId, `chat/${room}`, pending);
      if (res.error !== undefined) {
        setSendError(res.error);
        setSending(false);
        return;
      }
      attachment = { attachment_path: res.path, attachment_name: pending.name, attachment_type: pending.type || null };
    }

    const { error: insertError } = await supabase
      .from("chat_messages")
      .insert({ team_id: teamId, room, content, ...attachment });
    setSending(false);
    if (insertError) {
      setSendError(insertError.message);
      if (attachment) await removeFile(attachment.attachment_path);
      return;
    }
    setDraft("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      {open && (
        <div className="flex h-[420px] w-[320px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span className="text-base">💬</span> Team chat
            </span>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              title="Close chat"
            >
              ✕
            </button>
          </div>
          <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto bg-slate-50/60 p-3">
            {messages.length === 0 ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-xs text-slate-400">
                No messages yet — say hi 👋
              </div>
            ) : (
              messages.map((m) => {
                const mine = m.created_by === userId;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                        mine
                          ? "rounded-br-md bg-indigo-600 text-white"
                          : "rounded-bl-md border border-slate-200 bg-white text-slate-800"
                      }`}
                    >
                      {!mine && (
                        <p className="mb-0.5 text-[11px] font-semibold text-indigo-700">
                          {m.profiles?.email?.split("@")[0] || "Unknown"}
                        </p>
                      )}
                      {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
                      {m.attachment_path && (
                        <MessageAttachment
                          path={m.attachment_path}
                          name={m.attachment_name ?? "file"}
                          type={m.attachment_type}
                          mine={mine}
                        />
                      )}
                      <p className={`mt-1 text-[10px] ${mine ? "text-indigo-200" : "text-slate-400"}`}>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                      <div className="mt-1">
                        <Reactions
                          compact
                          reactions={messageReactions.byTarget.get(m.id) ?? []}
                          userId={userId}
                          onToggle={(emoji) => messageReactions.toggle(m.id, emoji)}
                        />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {(file || sendError) && (
            <div className="border-t border-slate-100 bg-white px-3 pt-2 text-xs">
              {file && (
                <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1 text-slate-600">
                  <span>📎</span>
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="text-slate-400">{formatBytes(file.size)}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="text-slate-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
              )}
              {sendError && <p className="mt-1 text-red-600">{sendError}</p>}
            </div>
          )}
          <form onSubmit={send} className="flex items-center gap-2 border-t border-slate-100 bg-white p-2.5">
            <input ref={fileInputRef} type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
              title="Attach a file (max 10 MB)"
            >
              📎
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a message…"
              className="input py-2 text-sm"
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={(!draft.trim() && !file) || sending}
              className="btn-primary shrink-0 px-3 py-2 text-sm"
              title="Send"
            >
              ➤
            </button>
          </form>
        </div>
      )}
      <button
        onClick={() => {
          const nowOpen = !open;
          openRef.current = nowOpen;
          setOpen(nowOpen);
          if (nowOpen) setUnread(0);
        }}
        className="relative flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-xl text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-700 active:scale-95"
        title="Team chat"
      >
        💬
        {unread > 0 && !open && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}

function MessageAttachment({ path, name, type, mine }: { path: string; name: string; type: string | null; mine: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = !!type?.startsWith("image/");

  useEffect(() => {
    let mounted = true;
    void signedUrl(path).then((u) => mounted && setUrl(u));
    return () => {
      mounted = false;
    };
  }, [path]);

  if (isImage && url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="mt-1 block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name} className="max-h-48 rounded-lg object-cover" />
      </a>
    );
  }
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      className={`mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium underline-offset-2 hover:underline ${
        mine ? "bg-white/15 text-white" : "bg-slate-100 text-slate-700"
      }`}
    >
      <span>{isImage ? "🖼️" : "📄"}</span>
      <span className="truncate">{name}</span>
    </a>
  );
}
