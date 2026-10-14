"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Header from "@/components/Header";
import KanbanBoard from "@/components/KanbanBoard";
import { Cursors, OnlineAvatars } from "@/components/Presence";
import TaskList from "@/components/TaskList";
import TaskModal from "@/components/TaskModal";
import { supabase } from "@/lib/supabase";
import { useCollaboration } from "@/lib/useCollaboration";
import { useUser } from "@/lib/useUser";
import { createNotification } from "@/lib/useNotifications";
import type { Column, Project, Task, TeamMember } from "@/lib/types";

export default function ProjectView() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const [project, setProject] = useState<Project | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [view, setView] = useState<"list" | "board">("board");
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    const { data } = await supabase.from("tasks").select("*").eq("project_id", id).order("position");
    setTasks(data ?? []);
  }, [id]);

  const loadColumns = useCallback(async () => {
    const { data } = await supabase.from("columns").select("*").eq("project_id", id).order("position");
    setColumns(data ?? []);
  }, [id]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: p, error } = await supabase.from("projects").select("*").eq("id", id).single();
      if (error) return setError("Project not found or you don't have access.");
      setProject(p);
      const { data: m } = await supabase
        .from("team_members")
        .select("user_id, role, profiles(id, email, full_name)")
        .eq("team_id", p.team_id);
      setMembers((m as unknown as TeamMember[]) ?? []);
      loadColumns();
      loadTasks();
    })();
  }, [user, id, loadColumns, loadTasks]);

  const syncAll = useCallback(() => {
    loadTasks();
    loadColumns();
  }, [loadTasks, loadColumns]);

  const myName =
    members.find((m) => m.user_id === user?.id)?.profiles?.full_name || user?.email?.split("@")[0] || "Someone";
  const collab = useCollaboration(id, user?.id, myName, syncAll);
  const { notifyChanged } = collab;
  const mainRef = useRef<HTMLElement>(null);

  // Live database changes from teammates, applied straight into state.
  // Delete events only carry the row id, so they can't be filtered by project.
  useEffect(() => {
    if (!user) return;
    const upsert = <T extends { id: string }>(list: T[], row: T) =>
      list.some((r) => r.id === row.id) ? list.map((r) => (r.id === row.id ? row : r)) : [...list, row];

    const channel = supabase
      .channel(`project-${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "tasks", filter: `project_id=eq.${id}` },
        ({ new: row }) => setTasks((prev) => upsert(prev, row as Task)),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tasks", filter: `project_id=eq.${id}` },
        ({ new: row }) => setTasks((prev) => upsert(prev, row as Task)),
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "tasks" }, ({ old }) =>
        setTasks((prev) => prev.filter((t) => t.id !== old.id)),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "columns", filter: `project_id=eq.${id}` },
        ({ new: row }) => setColumns((prev) => upsert(prev, row as Column).sort((a, b) => a.position - b.position)),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "columns", filter: `project_id=eq.${id}` },
        ({ new: row }) => setColumns((prev) => upsert(prev, row as Column).sort((a, b) => a.position - b.position)),
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "columns" }, ({ old }) => {
        setColumns((prev) => prev.filter((c) => c.id !== old.id));
        setTasks((prev) => prev.filter((t) => t.column_id !== old.id));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, id]);

  function trackCursor(e: React.PointerEvent) {
    const rect = mainRef.current?.getBoundingClientRect();
    if (rect) collab.sendCursor(e.clientX - rect.left, e.clientY - rect.top, view);
  }

  async function updateTask(taskId: string, changes: Partial<Task>) {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...changes } : t)));
    const { error } = await supabase.from("tasks").update(changes).eq("id", taskId);
    if (error) {
      setError(error.message);
      loadTasks();
    } else {
      notifyChanged();
      // Notify assignee if task was assigned
      if (changes.assignee_id && changes.assignee_id !== user?.id) {
        const task = tasks.find((t) => t.id === taskId);
        const member = members.find((m) => m.user_id === changes.assignee_id);
        if (task && member) {
          await createNotification(
            changes.assignee_id,
            "task_assigned",
            `${user?.email?.split("@")[0]} assigned you "${task.title}"`,
            `/project/${id}`,
            user?.id,
          );
        }
      }
    }
  }

  async function createTask(title: string, columnId: string) {
    const inColumn = tasks.filter((t) => t.column_id === columnId);
    const position = inColumn.length ? Math.max(...inColumn.map((t) => t.position)) + 1000 : 1000;
    const { data, error } = await supabase
      .from("tasks")
      .insert({ project_id: id, column_id: columnId, title, position })
      .select()
      .single();
    if (error) return setError(error.message);
    setTasks((prev) => (prev.some((t) => t.id === data.id) ? prev : [...prev, data]));
    notifyChanged();
  }

  async function deleteTask(taskId: string) {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    const { error } = await supabase.from("tasks").delete().eq("id", taskId);
    if (error) {
      setError(error.message);
      loadTasks();
    } else notifyChanged();
  }

  async function addColumn(name: string) {
    const position = columns.length ? columns[columns.length - 1].position + 1000 : 1000;
    const { error } = await supabase.from("columns").insert({ project_id: id, name, position });
    if (error) return setError(error.message);
    loadColumns();
    notifyChanged();
  }

  async function submitColumn(e: React.FormEvent) {
    e.preventDefault();
    if (!newColumnName.trim()) return;
    await addColumn(newColumnName.trim());
    setNewColumnName("");
    setAddingColumn(false);
  }

  async function renameColumn(columnId: string, name: string) {
    setColumns((prev) => prev.map((c) => (c.id === columnId ? { ...c, name } : c)));
    await supabase.from("columns").update({ name }).eq("id", columnId);
    notifyChanged();
    // Notify all teammates
    for (const m of members) {
      if (m.user_id !== user?.id) {
        await createNotification(
          m.user_id,
          "column_renamed",
          `${user?.email?.split("@")[0]} renamed a column to "${name}"`,
          `/project/${id}`,
          user?.id,
        );
      }
    }
  }

  async function deleteColumn(columnId: string) {
    setColumns((prev) => prev.filter((c) => c.id !== columnId));
    setTasks((prev) => prev.filter((t) => t.column_id !== columnId));
    await supabase.from("columns").delete().eq("id", columnId);
    notifyChanged();
  }

  if (!user) return null;

  return (
    <>
      <Header email={user.email} user={user} />
      <main
        ref={mainRef}
        onPointerMove={trackCursor}
        onPointerLeave={collab.hideCursor}
        className="relative mx-auto min-h-[calc(100vh-3.5rem)] max-w-7xl px-4 py-6 sm:py-8"
      >
        <Cursors cursors={collab.cursors} view={view} />
        {project && (
          <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition hover:text-indigo-600">
            ← Back to projects
          </Link>
        )}
        <div className="card mt-4 p-5 sm:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-sm font-medium text-indigo-600">Project workspace</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                {project?.name ?? "…"}
              </h1>
              {project?.description && (
                <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">{project.description}</p>
              )}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <OnlineAvatars online={collab.online} myId={user.id} />
              <div className="inline-flex rounded-xl border border-slate-200/80 bg-slate-100/70 p-1">
                {(["list", "board"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                      view === v ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {v === "list" ? "To-do list" : "Kanban"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        {view === "board" && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Board</h2>
            <button
              onClick={() => setAddingColumn((v) => !v)}
              className="btn-secondary px-3 py-1.5 text-sm"
            >
              {addingColumn ? "Cancel" : "+ Add column"}
            </button>
          </div>
        )}
        {addingColumn && view === "board" && (
          <form onSubmit={submitColumn} className="card mt-3 flex items-center gap-2 p-3">
            <input
              className="input bg-slate-50/80"
              placeholder="New column name"
              value={newColumnName}
              onChange={(e) => setNewColumnName(e.target.value)}
              autoFocus
              required
            />
            <button className="btn-primary shrink-0">Add</button>
          </form>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <div className="mt-6">
          {view === "list" ? (
            <TaskList
              columns={columns}
              tasks={tasks}
              members={members}
              onCreate={createTask}
              onUpdate={updateTask}
              onOpen={setEditing}
            />
          ) : (
            <KanbanBoard
              columns={columns}
              tasks={tasks}
              members={members}
              onCreate={createTask}
              onUpdate={updateTask}
              onOpen={setEditing}
              onAddColumn={addColumn}
              onRenameColumn={renameColumn}
              onDeleteColumn={deleteColumn}
              remoteDragging={collab.dragging}
              onDragStateChange={collab.sendDrag}
            />
          )}
        </div>
      </main>

      {editing && (
        <TaskModal
          task={editing}
          columns={columns}
          members={members}
          onClose={() => setEditing(null)}
          onSave={(changes) => {
            updateTask(editing.id, changes);
            setEditing(null);
          }}
          onDelete={() => {
            deleteTask(editing.id);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
