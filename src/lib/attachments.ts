import { supabase } from "./supabase";

export const ATTACHMENT_BUCKET = "attachments";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Uploads under "<teamId>/<folder>/…" (the storage policy keys off the team folder). */
export async function uploadAttachment(
  teamId: string,
  folder: string,
  file: File,
): Promise<{ path: string; error?: undefined } | { error: string; path?: undefined }> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { error: `${file.name} is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}` };
  }
  const safeName = file.name.replace(/[^\w.-]+/g, "_");
  const path = `${teamId}/${folder}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
  });
  if (error) return { error: error.message };
  return { path };
}

export async function signedUrl(path: string) {
  const { data } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

export async function removeFile(path: string) {
  await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]);
}
