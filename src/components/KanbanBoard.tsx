"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { positionBetween } from "@/lib/position";
import type { Column, Task, TeamMember } from "@/lib/types";
import type { Collaborator } from "@/lib/useCollaboration";
import { Avatar, DueDate, PriorityBadge } from "./TaskMeta";

type Props = {
  columns: Column[];
  tasks: Task[];
  members: TeamMember[];
  onCreate: (title: string, columnId: string) => void;
  onUpdate: (taskId: string, changes: Partial<Task>) => void;
  onOpen: (task: Task) => void;
  onAddColumn: (name: string) => void;
  onRenameColumn: (columnId: string, name: string) => void;
  onDeleteColumn: (columnId: string) => void;
  remoteDragging: Record<string, Collaborator>;
  onDragStateChange: (taskId: string | null) => void;
};

export default function KanbanBoard(props: Props) {
  const { columns, tasks, members, onUpdate, onAddColumn, onDragStateChange } = props;
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const [newColumn, setNewColumn] = useState("");

  // Small drag threshold so a plain click still opens the task.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const tasksIn = (columnId: string) =>
    tasks.filter((t) => t.column_id === columnId).sort((a, b) => a.position - b.position);

  function handleDragStart(e: DragStartEvent) {
    setActiveTask(tasks.find((t) => t.id === e.active.id) ?? null);
    onDragStateChange(String(e.active.id));
  }

  function handleDragOver(e: DragOverEvent) {
    setOverColumnId((e.over?.data.current?.columnId as string) ?? null);
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveTask(null);
    setOverColumnId(null);
    onDragStateChange(null);
    const { active, over } = e;
    if (!over) return;

    const task = tasks.find((t) => t.id === active.id);
    const targetColumnId = over.data.current?.columnId as string | undefined;
    if (!task || !targetColumnId) return;

    let ordered: Task[];
    if (targetColumnId === task.column_id) {
      const list = tasksIn(targetColumnId);
      const from = list.findIndex((t) => t.id === task.id);
      const to = over.data.current?.type === "task" ? list.findIndex((t) => t.id === over.id) : list.length - 1;
      if (from === to) return;
      ordered = arrayMove(list, from, to);
    } else {
      const list = tasksIn(targetColumnId);
      const at = over.data.current?.type === "task" ? list.findIndex((t) => t.id === over.id) : list.length;
      ordered = [...list.slice(0, at), task, ...list.slice(at)];
    }

    const i = ordered.findIndex((t) => t.id === task.id);
    const position = positionBetween(ordered[i - 1]?.position, ordered[i + 1]?.position);
    onUpdate(task.id, { column_id: targetColumnId, position });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveTask(null);
        setOverColumnId(null);
        onDragStateChange(null);
      }}
    >
      <div className="flex items-start gap-4 overflow-x-auto pb-4">
        {columns.map((column) => (
          <KanbanColumn
            key={column.id}
            {...props}
            column={column}
            tasks={tasksIn(column.id)}
            highlighted={overColumnId === column.id && activeTask?.column_id !== column.id}
          />
        ))}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newColumn.trim()) return;
            onAddColumn(newColumn.trim());
            setNewColumn("");
          }}
          className="w-72 shrink-0"
        >
          <input
            className="input bg-slate-50"
            placeholder="+ Add column"
            value={newColumn}
            onChange={(e) => setNewColumn(e.target.value)}
          />
        </form>
      </div>

      <DragOverlay>{activeTask && <TaskCard task={activeTask} members={members} dragging />}</DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({
  column,
  tasks,
  members,
  highlighted,
  onCreate,
  onOpen,
  onRenameColumn,
  onDeleteColumn,
  remoteDragging,
}: Props & { column: Column; tasks: Task[]; highlighted: boolean }) {
  const { setNodeRef } = useDroppable({ id: `column-${column.id}`, data: { type: "column", columnId: column.id } });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [name, setName] = useState(column.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-xl p-3 transition-colors ${highlighted ? "bg-indigo-50 ring-2 ring-indigo-200" : "bg-slate-100"}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <input
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== column.name && onRenameColumn(column.id, name.trim())}
        />
        <span className="text-xs text-slate-500">{tasks.length}</span>
        <button
          onClick={() => (confirmDelete ? onDeleteColumn(column.id) : setConfirmDelete(true))}
          onBlur={() => setConfirmDelete(false)}
          title="Delete column and its tasks"
          className={`text-xs ${confirmDelete ? "font-medium text-red-600" : "text-slate-400 hover:text-red-600"}`}
        >
          {confirmDelete ? "Delete?" : "✕"}
        </button>
      </div>

      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-10 flex-col gap-2">
          {tasks.map((task) => (
            <SortableTask
              key={task.id}
              task={task}
              members={members}
              onOpen={onOpen}
              movedBy={remoteDragging[task.id]}
            />
          ))}
        </div>
      </SortableContext>

      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) onCreate(title.trim(), column.id);
            setTitle("");
          }}
          className="mt-2"
        >
          <input
            className="input"
            placeholder="Task title, then Enter"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => !title && setAdding(false)}
            autoFocus
          />
        </form>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-500 hover:bg-slate-200"
        >
          + Add task
        </button>
      )}
    </div>
  );
}

function SortableTask({
  task,
  members,
  onOpen,
  movedBy,
}: {
  task: Task;
  members: TeamMember[];
  onOpen: (t: Task) => void;
  movedBy?: Collaborator;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "task", columnId: task.column_id },
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "opacity-30" : ""}
      onClick={() => onOpen(task)}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} members={members} movedBy={movedBy} />
    </div>
  );
}

function TaskCard({
  task,
  members,
  dragging,
  movedBy,
}: {
  task: Task;
  members: TeamMember[];
  dragging?: boolean;
  movedBy?: Collaborator;
}) {
  return (
    <div
      className={`relative cursor-grab rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:border-indigo-300 ${dragging ? "rotate-2 shadow-lg" : ""} ${movedBy ? "animate-pulse" : ""}`}
      style={movedBy ? { boxShadow: `0 0 0 2px ${movedBy.color}` } : undefined}
    >
      {movedBy && (
        <span
          className="absolute -top-2.5 right-2 rounded px-1.5 text-[10px] font-medium text-white"
          style={{ backgroundColor: movedBy.color }}
        >
          {movedBy.name} is moving
        </span>
      )}
      <p className="text-sm">{task.title}</p>
      <div className="mt-2 flex items-center gap-2">
        <PriorityBadge priority={task.priority} />
        <DueDate date={task.due_date} />
        <span className="ml-auto">
          <Avatar userId={task.assignee_id} members={members} />
        </span>
      </div>
    </div>
  );
}
