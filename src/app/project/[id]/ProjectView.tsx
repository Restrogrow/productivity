"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Header from "@/components/Header";
import KanbanBoard from "@/components/KanbanBoard";
import TaskList from "@/components/TaskList";
import TaskModal from "@/components/TaskModal";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/lib/useUser";
import type { Column, Project, Task, TeamMember } from "@/lib/types";

export default function ProjectView() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const [project, setProject] = useState<Project | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [view, setView] = useState<"list" | "board">("board");
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

  // Live updates when teammates change tasks or columns.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`project-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `project_id=eq.${id}` }, loadTasks)
      .on("postgres_changes", { event: "*", schema: "public", table: "columns", filter: `project_id=eq.${id}` }, loadColumns)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, id, loadTasks, loadColumns]);

  async function updateTask(taskId: string, changes: Partial<Task>) {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...changes } : t)));
    const { error } = await supabase.from("tasks").update(changes).eq("id", taskId);
    if (error) {
      setError(error.message);
      loadTasks();
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
  }

  async function deleteTask(taskId: string) {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    const { error } = await supabase.from("tasks").delete().eq("id", taskId);
    if (error) {
      setError(error.message);
      loadTasks();
    }
  }

  async function addColumn(name: string) {
    const position = columns.length ? columns[columns.length - 1].position + 1000 : 1000;
    const { error } = await supabase.from("columns").insert({ project_id: id, name, position });
    if (error) return setError(error.message);
    loadColumns();
  }

  async function renameColumn(columnId: string, name: string) {
    setColumns((prev) => prev.map((c) => (c.id === columnId ? { ...c, name } : c)));
    await supabase.from("columns").update({ name }).eq("id", columnId);
  }

  async function deleteColumn(columnId: string) {
    setColumns((prev) => prev.filter((c) => c.id !== columnId));
    setTasks((prev) => prev.filter((t) => t.column_id !== columnId));
    await supabase.from("columns").delete().eq("id", columnId);
  }

  if (!user) return null;

  return (
    <>
      <Header email={user.email} />
      <main className="mx-auto max-w-7xl px-4 py-6">
        {project && (
          <Link href={`/team/${project.team_id}`} className="text-sm text-slate-500 hover:text-slate-800">
            ← Back to team
          </Link>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{project?.name ?? "…"}</h1>
            {project?.description && <p className="text-sm text-slate-500">{project.description}</p>}
          </div>
          <div className="flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
            {(["list", "board"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-md px-4 py-1.5 ${view === v ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {v === "list" ? "To-do list" : "Kanban"}
              </button>
            ))}
          </div>
        </div>
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
