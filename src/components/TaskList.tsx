"use client";

import { useState } from "react";
import type { Column, Task, TeamMember } from "@/lib/types";
import { Avatar, DueDate, PriorityBadge } from "./TaskMeta";

type Props = {
  columns: Column[];
  tasks: Task[];
  members: TeamMember[];
  onCreate: (title: string, columnId: string) => void;
  onUpdate: (taskId: string, changes: Partial<Task>) => void;
  onOpen: (task: Task) => void;
};

// The first column is treated as "to do" and the last as "done".
export default function TaskList({ columns, tasks, members, onCreate, onUpdate, onOpen }: Props) {
  const [title, setTitle] = useState("");
  const [showDone, setShowDone] = useState(false);
  const firstCol = columns[0];
  const lastCol = columns[columns.length - 1];

  const sorted = [...tasks].sort((a, b) => {
    const ca = columns.findIndex((c) => c.id === a.column_id);
    const cb = columns.findIndex((c) => c.id === b.column_id);
    return ca - cb || a.position - b.position;
  });
  const visible = sorted.filter((t) => showDone || t.column_id !== lastCol?.id);
  const doneCount = tasks.filter((t) => t.column_id === lastCol?.id).length;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !firstCol) return;
    onCreate(title.trim(), firstCol.id);
    setTitle("");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <form onSubmit={submit} className="card flex items-center gap-2 p-3">
        <input
          className="input border-slate-300/70 bg-slate-50/80"
          placeholder="Add a task and press Enter"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className="btn-primary shrink-0">Add</button>
      </form>

      <div className="mt-5 space-y-2">
        {visible.map((task) => {
          const done = task.column_id === lastCol?.id;
          const column = columns.find((c) => c.id === task.column_id);
          return (
            <div
              key={task.id}
              className={`card flex items-center gap-3 p-3 transition-all hover:-translate-y-0.5 hover:shadow-md ${
                done ? "opacity-70" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={done}
                onChange={() => onUpdate(task.id, { column_id: done ? firstCol.id : lastCol.id })}
                className="h-4 w-4 cursor-pointer accent-indigo-600"
              />
              <button onClick={() => onOpen(task)} className="min-w-0 flex-1 text-left">
                <p className={`truncate text-sm font-medium ${done ? "text-slate-400 line-through" : "text-slate-800"}`}>{task.title}</p>
              </button>
              <span className="hidden rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 sm:inline">
                {column?.name}
              </span>
              <PriorityBadge priority={task.priority} />
              <DueDate date={task.due_date} done={done} />
              <Avatar userId={task.assignee_id} members={members} />
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="card flex flex-col items-center justify-center px-6 py-14 text-center">
            <div className="text-3xl">🎉</div>
            <p className="mt-2 text-sm font-medium text-slate-700">Nothing left to do</p>
            <p className="text-xs text-slate-500">Add a task above to get started.</p>
          </div>
        )}
      </div>

      {doneCount > 0 && (
        <button
          onClick={() => setShowDone(!showDone)}
          className="mt-4 text-sm font-medium text-slate-500 transition hover:text-indigo-600"
        >
          {showDone ? "Hide" : "Show"} completed ({doneCount})
        </button>
      )}
    </div>
  );
}
