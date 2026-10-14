"use client";

import { useEffect, useRef, useState } from "react";
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
  const elapsedRef = useRef(0); // ref so onstop always sees the latest value

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startRecording = async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: true,
      });

      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        // Mic not available, continue without it
      }

      const tracks = [
        ...screenStream.getVideoTracks(),
        ...screenStream.getAudioTracks(),
        ...(micStream?.getAudioTracks() || []),
      ];
      const combinedStream = new MediaStream(tracks);
      streamRef.current = combinedStream;

      const mimeTypes = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ];
      const mimeType = mimeTypes.find((t) => MediaRecorder.isTypeSupported(t)) || "video/webm";

      const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 2_500_000,
      });
      recorderRef.current = recorder;
      chunksRef.current = [];
      elapsedRef.current = 0;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size === 0) {
          setError("Recording was empty. Please try again.");
          return;
        }
        await saveRecording(blob, elapsedRef.current);
        combinedStream.getTracks().forEach((t) => t.stop());
        micStream?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };

      recorder.start(500);
      setRecording(true);
      setElapsed(0);
      setError(null);
      timerRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setElapsed(elapsedRef.current);
      }, 1000);

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

  async function saveRecording(blob: Blob, durationSeconds: number) {
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
      duration_seconds: durationSeconds,
      storage_path: path,
    });

    if (dbError) {
      setError("Recording saved but failed to add record: " + dbError.message);
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
