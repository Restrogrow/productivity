"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Props = {
  teamId: string;
  projectId?: string;
  whiteboardId?: string;
  onRecordingSaved?: () => void;
};

export default function Recorder({ teamId, projectId, whiteboardId, onRecordingSaved }: Props) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startRecording = async () => {
    try {
      // Capture screen
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: true,
      });

      // Try to also get microphone
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        // Mic not available, continue without it
      }

      // Combine tracks
      const tracks = [
        ...screenStream.getVideoTracks(),
        ...screenStream.getAudioTracks(),
        ...(micStream?.getAudioTracks() || []),
      ];
      const combinedStream = new MediaStream(tracks);
      streamRef.current = combinedStream;

      // Pick a supported mime type
      const mimeTypes = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
        "video/mp4",
      ];
      const mimeType = mimeTypes.find((t) => MediaRecorder.isTypeSupported(t)) || "";

      const recorder = new MediaRecorder(
        combinedStream,
        mimeType ? { mimeType, videoBitsPerSecond: 2_500_000 } : undefined,
      );
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || "video/webm" });
        await saveRecording(blob);
        combinedStream.getTracks().forEach((t) => t.stop());
        micStream?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };

      recorder.start(1000); // collect data every 1s
      setRecording(true);
      setElapsed(0);
      setError(null);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);

      // If user stops via browser UI
      screenStream.getVideoTracks()[0].onended = () => {
        if (recorderRef.current?.state === "recording") {
          recorderRef.current.stop();
        }
        setRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);
      };
    } catch (err: any) {
      if (err.name !== "NotAllowedError") {
        setError("Could not start recording. Please allow screen capture.");
      }
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  async function saveRecording(blob: Blob) {
    setSaving(true);
    const ext = blob.type.includes("mp4") ? "mp4" : "webm";
    const name = `recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
    const path = `${teamId}/${name}`;

    const { error: uploadError } = await supabase.storage
      .from("recordings")
      .upload(path, blob, { contentType: blob.type });

    if (uploadError) {
      setError("Failed to save recording: " + uploadError.message);
      setSaving(false);
      return;
    }

    const { error: dbError } = await supabase.from("recordings").insert({
      team_id: teamId,
      project_id: projectId || null,
      whiteboard_id: whiteboardId || null,
      name: name,
      duration_seconds: elapsed,
      storage_path: path,
    });

    if (dbError) {
      setError("Recording saved to storage but failed to add record: " + dbError.message);
    } else {
      onRecordingSaved?.();
    }
    setSaving(false);
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {!recording ? (
          <button
            onClick={startRecording}
            disabled={saving}
            className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-sm"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />
            </svg>
            Record
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-red-700"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            Stop ({formatTime(elapsed)})
          </button>
        )}
        {recording && (
          <span className="flex items-center gap-1 text-xs text-red-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            REC {formatTime(elapsed)}
          </span>
        )}
        {saving && <span className="text-xs text-slate-500">Saving...</span>}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
