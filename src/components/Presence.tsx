import type { Collaborator, RemoteCursor } from "@/lib/useCollaboration";

export function OnlineAvatars({ online, myId }: { online: Collaborator[]; myId?: string }) {
  if (online.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500">Online</span>
      <div className="flex -space-x-2">
        {online.map((p) => (
          <span
            key={p.userId}
            title={p.userId === myId ? `${p.name} (you)` : p.name}
            style={{ backgroundColor: p.color }}
            className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-white"
          >
            {p.name.slice(0, 1).toUpperCase()}
          </span>
        ))}
      </div>
    </div>
  );
}

// Teammates' cursors, positioned relative to the nearest `relative` ancestor.
export function Cursors({ cursors, view }: { cursors: Record<string, RemoteCursor>; view: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
      {Object.values(cursors)
        .filter((c) => c.view === view)
        .map((c) => (
          <div
            key={c.userId}
            className="absolute left-0 top-0 transition-transform duration-75 ease-linear"
            style={{ transform: `translate(${c.x}px, ${c.y}px)` }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill={c.color}>
              <path d="M1 1l6 15 2.2-6.3L16 7.5z" stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
            <span
              className="ml-3 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-white shadow"
              style={{ backgroundColor: c.color }}
            >
              {c.name}
            </span>
          </div>
        ))}
    </div>
  );
}
