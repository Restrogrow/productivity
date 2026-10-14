"use client";

import { useState } from "react";
import type { Column, Priority, Task, TeamMember } from "@/lib/types";

type Props = {
  task: Task;
  columns: Column[];
  members: TeamMember[];
  onClose: () => void;
  onSave: (changes: Partial<Task>) => void;
  onDelete: () => void;
};

export default function TaskModal({ task, columns, members, onClose, onSave, onDelete }: Props) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [columnId, setColumnId] = useState(task.column_id);
  const [assigneeId, setAssigneeId] = useState(task.assignee_id ?? "");
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="card w-full max-w-lg space-y-4 p-6">
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
