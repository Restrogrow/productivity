"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) return setError(error.message);
      router.replace("/dashboard");
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      setLoading(false);
      if (error) return setError(error.message);
      if (data.session) router.replace("/dashboard");
      else setMessage("Check your email to confirm your account, then sign in.");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-lg font-bold text-white shadow-lg shadow-indigo-600/25">
            P
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">Productivy</h1>
          <p className="mt-2 text-sm text-slate-600">A shared workspace for your team’s tasks and projects.</p>
        </div>

        <div className="card p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-slate-900">
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {mode === "signin" ? "Sign in to continue" : "Get started in seconds"}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "signup" && (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-600">Full name</span>
                <input className="input" placeholder="Your name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </label>
            )}
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-600">Email</span>
              <input className="input" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-600">Password</span>
              <input className="input" type="password" placeholder="Minimum 6 characters" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
            </label>

            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {message && <p className="rounded-xl bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p>}

            <button disabled={loading} className="btn-primary w-full">
              {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <button
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setMessage(null);
            }}
            className="mt-5 w-full text-center text-sm text-slate-600 transition hover:text-indigo-600"
          >
            {mode === "signin" ? "No account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </main>
  );
}