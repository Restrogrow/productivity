# Productivy

Team task manager: teams, projects, a to-do list and a Kanban board, with live updates.

Built with Next.js, Tailwind CSS, Supabase (Postgres, Auth, Realtime) and dnd-kit.

## Features

- Email/password sign up and sign in
- Teams: create a team, add teammates by email (they must sign up first)
- Projects with default columns: To Do, In Progress, Done
- To-do list view: quick add, tick to complete, show/hide completed
- Kanban view: drag and drop between columns, add/rename/delete columns
- Task details: description, assignee, due date (overdue highlighted), priority
- Realtime: changes from teammates appear without refreshing
- Row Level Security: users only see their own teams' data

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env.local` and fill in your Supabase URL, anon key and database connection string.
3. Create the database tables, policies and triggers:
   ```bash
   npm run db:setup
   ```
   Or paste `supabase/schema.sql` into the Supabase SQL Editor and run it. The script is safe to re-run.
4. Start the app:
   ```bash
   npm run dev
   ```
   Open http://localhost:3000.

Optional: to skip email confirmation while testing, disable "Confirm email" under Authentication → Sign In / Providers → Email in Supabase.

## Project structure

```
supabase/schema.sql        tables, RLS policies, triggers, RPCs, realtime
scripts/run-sql.mjs        applies schema.sql using DATABASE_URL
src/app/login              sign in / sign up
src/app/dashboard          your teams
src/app/team/[id]          team projects and members
src/app/project/[id]       to-do list and Kanban views
src/components             KanbanBoard, TaskList, TaskModal, Header
src/lib                    Supabase client, types, helpers
```
