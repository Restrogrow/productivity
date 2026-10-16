"use client";

import { useState } from "react";
import { REACTION_EMOJIS } from "@/lib/useReactions";
import type { Reaction } from "@/lib/types";

type Props = {
  reactions: Reaction[];
  userId: string | undefined;
  onToggle: (emoji: string) => void;
  /** Smaller chips for task cards / chat bubbles. */
  compact?: boolean;
  /** Hide the "add" button and only show existing reactions (task cards). */
  hideAdd?: boolean;
};

export default function Reactions({ reactions, userId, onToggle, compact, hideAdd }: Props) {
  const [picking, setPicking] = useState(false);

  const grouped = new Map<string, { count: number; mine: boolean }>();
  for (const r of reactions) {
    const g = grouped.get(r.emoji) ?? { count: 0, mine: false };
    g.count++;
    if (r.user_id === userId) g.mine = true;
    grouped.set(r.emoji, g);
  }

  // Keep clicks from dragging the card or opening the task modal.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const size = compact ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1 text-xs";

  if (grouped.size === 0 && hideAdd) return null;

  return (
    <div className="relative flex flex-wrap items-center gap-1" onPointerDown={stop} onClick={stop}>
      {[...grouped.entries()].map(([emoji, g]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onToggle(emoji)}
          className={`flex items-center gap-1 rounded-full border font-medium transition ${size} ${
            g.mine
              ? "border-indigo-300 bg-indigo-50 text-indigo-700"
              : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200"
          }`}
          title={g.mine ? "Remove your reaction" : "React"}
        >
          <span>{emoji}</span>
          <span>{g.count}</span>
        </button>
      ))}
      {!hideAdd && (
        <button
          type="button"
          onClick={() => setPicking((v) => !v)}
          className={`rounded-full border border-dashed border-slate-300 bg-white font-medium text-slate-400 transition hover:border-indigo-300 hover:text-indigo-600 ${size}`}
          title="Add reaction"
        >
          ☺ +
        </button>
      )}
      {picking && (
        <div className="absolute bottom-full left-0 z-30 mb-1 flex gap-0.5 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onToggle(emoji);
                setPicking(false);
              }}
              className="rounded-lg px-1.5 py-1 text-base transition hover:scale-110 hover:bg-slate-100"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
