import type { Priority, TeamMember } from "@/lib/types";

const priorityStyles: Record<Priority, string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-red-100 text-red-700",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ${priorityStyles[priority]}`}>
      {priority}
    </span>
  );
}

export function DueDate({ date, done }: { date: string | null; done?: boolean }) {
  if (!date) return null;
  const overdue = !done && new Date(date) < new Date(new Date().toDateString());
  return (
    <span className={`text-[11px] ${overdue ? "font-medium text-red-600" : "text-slate-500"}`}>
      {new Date(date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
    </span>
  );
}

export function Avatar({ userId, members }: { userId: string | null; members: TeamMember[] }) {
  if (!userId) return null;
  const profile = members.find((m) => m.user_id === userId)?.profiles;
  const name = profile?.full_name || profile?.email || "?";
  return (
    <span
      title={name}
      className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-700"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
