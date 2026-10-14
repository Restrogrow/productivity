export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
};

export type Team = {
  id: string;
  name: string;
  created_at: string;
};

export type TeamMember = {
  user_id: string;
  role: "owner" | "member";
  profiles: Profile | null;
};

export type Project = {
  id: string;
  team_id: string;
  name: string;
  description: string | null;
  created_at: string;
};

export type Whiteboard = {
  id: string;
  team_id: string;
  name: string;
  data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type Column = {
  id: string;
  project_id: string;
  name: string;
  position: number;
};

export type Priority = "low" | "medium" | "high";

export type Task = {
  id: string;
  project_id: string;
  column_id: string;
  title: string;
  description: string | null;
  assignee_id: string | null;
  due_date: string | null;
  priority: Priority;
  position: number;
  created_at: string;
};
