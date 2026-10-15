-- Productivy v1 schema: teams, projects, kanban columns, tasks.
-- Safe to re-run.

-- ---------- Tables ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text unique,
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null,
  description text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.columns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  position double precision not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  column_id uuid not null references public.columns (id) on delete cascade,
  title text not null,
  description text,
  assignee_id uuid references public.profiles (id) on delete set null,
  due_date date,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  position double precision not null default 0,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists team_members_user_idx on public.team_members (user_id);
create index if not exists projects_team_idx on public.projects (team_id);
create index if not exists columns_project_idx on public.columns (project_id);
create index if not exists tasks_project_idx on public.tasks (project_id);
create index if not exists tasks_column_idx on public.tasks (column_id);

-- ---------- Helper functions (security definer so RLS policies don't recurse) ----------

create or replace function public.is_team_member(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = t and user_id = auth.uid());
$$;

create or replace function public.is_team_owner(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = t and user_id = auth.uid() and role = 'owner');
$$;

create or replace function public.project_team(p uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select team_id from projects where id = p;
$$;

create or replace function public.shares_team_with(u uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members a
    join team_members b on a.team_id = b.team_id
    where a.user_id = auth.uid() and b.user_id = u
  );
$$;

-- ---------- Triggers ----------

-- Create a profile row for every new auth user.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for users who signed up before the trigger existed.
insert into public.profiles (id, email, full_name)
select id, email, coalesce(raw_user_meta_data ->> 'full_name', split_part(email, '@', 1))
from auth.users
on conflict (id) do nothing;

-- Every new project gets default kanban columns.
create or replace function public.handle_new_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into columns (project_id, name, position) values
    (new.id, 'To Do', 1000),
    (new.id, 'In Progress', 2000),
    (new.id, 'Done', 3000);
  return new;
end;
$$;

drop trigger if exists on_project_created on public.projects;
create trigger on_project_created
  after insert on public.projects
  for each row execute function public.handle_new_project();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_touch_updated_at on public.tasks;
create trigger tasks_touch_updated_at
  before update on public.tasks
  for each row execute function public.touch_updated_at();

-- ---------- RPCs ----------

-- Create a team and make the caller its owner.
create or replace function public.create_team(team_name text)
returns public.teams language plpgsql security definer set search_path = public as $$
declare
  t teams;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  insert into teams (name, created_by) values (team_name, auth.uid()) returning * into t;
  insert into team_members (team_id, user_id, role) values (t.id, auth.uid(), 'owner');
  return t;
end;
$$;

-- Owner adds an existing user (who has signed up) to the team by email.
create or replace function public.add_team_member(t uuid, member_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
begin
  if not is_team_owner(t) then
    raise exception 'Only team owners can add members';
  end if;
  select id into uid from profiles where lower(email) = lower(trim(member_email));
  if uid is null then
    raise exception 'No user with that email has signed up yet';
  end if;
  insert into team_members (team_id, user_id, role) values (t, uid, 'member')
  on conflict do nothing;
end;
$$;

-- ---------- Row Level Security ----------

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.projects enable row level security;
alter table public.columns enable row level security;
alter table public.tasks enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_team_with(id));
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "teams_select" on public.teams;
create policy "teams_select" on public.teams for select to authenticated
  using (public.is_team_member(id));
drop policy if exists "teams_update" on public.teams;
create policy "teams_update" on public.teams for update to authenticated
  using (public.is_team_owner(id));
drop policy if exists "teams_delete" on public.teams;
create policy "teams_delete" on public.teams for delete to authenticated
  using (public.is_team_owner(id));

drop policy if exists "team_members_select" on public.team_members;
create policy "team_members_select" on public.team_members for select to authenticated
  using (public.is_team_member(team_id));
drop policy if exists "team_members_delete" on public.team_members;
create policy "team_members_delete" on public.team_members for delete to authenticated
  using (public.is_team_owner(team_id) or user_id = auth.uid());

drop policy if exists "projects_all" on public.projects;
create policy "projects_all" on public.projects for all to authenticated
  using (public.is_team_member(team_id)) with check (public.is_team_member(team_id));

drop policy if exists "columns_all" on public.columns;
create policy "columns_all" on public.columns for all to authenticated
  using (public.is_team_member(public.project_team(project_id)))
  with check (public.is_team_member(public.project_team(project_id)));

drop policy if exists "tasks_all" on public.tasks;
create policy "tasks_all" on public.tasks for all to authenticated
  using (public.is_team_member(public.project_team(project_id)))
  with check (public.is_team_member(public.project_team(project_id)));

-- ---------- EOD Updates ----------
create table if not exists public.eod_updates (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  content text not null,
  update_date date not null default current_date,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists eod_updates_team_idx on public.eod_updates (team_id);

alter table public.eod_updates enable row level security;

drop policy if exists "eod_updates_all" on public.eod_updates;
create policy "eod_updates_all" on public.eod_updates for all to authenticated
  using (public.is_team_member(team_id)) with check (public.is_team_member(team_id));

-- ---------- Realtime ----------

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tasks') then
    alter publication supabase_realtime add table public.tasks;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'columns') then
    alter publication supabase_realtime add table public.columns;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'projects') then
    alter publication supabase_realtime add table public.projects;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'whiteboards') then
    alter publication supabase_realtime add table public.whiteboards;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'eod_updates') then
    alter publication supabase_realtime add table public.eod_updates;
  end if;
end;
$$;

-- ---------- Whiteboards ----------
create table if not exists public.whiteboards (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null,
  data jsonb not null default '{"elements":[]}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whiteboards_team_idx on public.whiteboards (team_id);

drop trigger if exists whiteboards_touch_updated_at on public.whiteboards;
create trigger whiteboards_touch_updated_at
  before update on public.whiteboards
  for each row execute function public.touch_updated_at();

alter table public.whiteboards enable row level security;

drop policy if exists "whiteboards_all" on public.whiteboards;
create policy "whiteboards_all" on public.whiteboards for all to authenticated
  using (public.is_team_member(team_id)) with check (public.is_team_member(team_id));

-- ---------- Recordings ----------
create table if not exists public.recordings (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  whiteboard_id uuid references public.whiteboards (id) on delete cascade,
  name text not null,
  duration_seconds integer not null default 0,
  storage_path text not null,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists recordings_team_idx on public.recordings (team_id);
create index if not exists recordings_project_idx on public.recordings (project_id);
create index if not exists recordings_whiteboard_idx on public.recordings (whiteboard_id);

alter table public.recordings enable row level security;

drop policy if exists "recordings_select" on public.recordings;
create policy "recordings_select" on public.recordings for select to authenticated
  using (public.is_team_member(team_id));
drop policy if exists "recordings_insert" on public.recordings;
create policy "recordings_insert" on public.recordings for insert to authenticated
  with check (public.is_team_member(team_id));
drop policy if exists "recordings_delete" on public.recordings;
create policy "recordings_delete" on public.recordings for delete to authenticated
  using (public.is_team_member(team_id));

-- ---------- Storage bucket for recordings ----------
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

drop policy if exists "recordings_storage_select" on storage.objects;
create policy "recordings_storage_select" on storage.objects for select to authenticated
  using (bucket_id = 'recordings');
drop policy if exists "recordings_storage_insert" on storage.objects;
create policy "recordings_storage_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'recordings');
drop policy if exists "recordings_storage_delete" on storage.objects;
create policy "recordings_storage_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'recordings');

-- ---------- Notifications ----------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('task_assigned', 'task_completed', 'column_renamed', 'screen_share', 'recording', 'mention', 'project_created')),
  message text not null,
  link text,
  read boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id);
create index if not exists notifications_read_idx on public.notifications (user_id, read);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select" on public.notifications;
create policy "notifications_select" on public.notifications for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "notifications_insert" on public.notifications;
create policy "notifications_insert" on public.notifications for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "notifications_update" on public.notifications;
create policy "notifications_update" on public.notifications for update to authenticated
  using (user_id = auth.uid());
drop policy if exists "notifications_delete" on public.notifications;
create policy "notifications_delete" on public.notifications for delete to authenticated
  using (user_id = auth.uid());
