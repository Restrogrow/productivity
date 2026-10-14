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
      <form onSubmit={submit} className="flex gap-2">
        <input
          className="input"
          placeholder="Add a task and press Enter"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className="btn-primary">Add</button>
      </form>

      <ul className="card mt-4 divide-y divide-slate-100">
        {visible.map((task) => {
          const done = task.column_id === lastCol?.id;
          const column = columns.find((c) => c.id === task.column_id);
          return (
            <li key={task.id} className="flex items-center gap-3 px-4 py-3">
              <input
                type="checkbox"
                checked={done}
                onChange={() => onUpdate(task.id, { column_id: done ? firstCol.id : lastCol.id })}
                className="h-4 w-4 cursor-pointer accent-indigo-600"
              />
              <button onClick={() => onOpen(task)} className="min-w-0 flex-1 text-left">
                <p className={`truncate text-sm ${done ? "text-slate-400 line-through" : ""}`}>{task.title}</p>
              </button>
              <span className="hidden rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 sm:inline">
                {column?.name}
              </span>
              <PriorityBadge priority={task.priority} />
              <DueDate date={task.due_date} done={done} />
              <Avatar userId={task.assignee_id} members={members} />
            </li>
          );
        })}
        {visible.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">Nothing to do 🎉</li>}
      </ul>

      {doneCount > 0 && (
        <button onClick={() => setShowDone(!showDone)} className="mt-3 text-sm text-slate-500 hover:text-slate-800">
          {showDone ? "Hide" : "Show"} completed ({doneCount})
        </button>
      )}
    </div>
  );
}
