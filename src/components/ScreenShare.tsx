"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Props = {
  roomId: string;
  /** Optional — a guest (e.g. /watch page) without a signed-in user gets a
   * per-mount identity generated internally. */
  userId?: string;
  userName?: string;
  onShareStart?: () => void;
  /** "toolbar" fits inside the old whiteboard toolbar; "panel" is the bigger standalone-page UI. */
  variant?: "toolbar" | "panel";
};

type Peer = {
  userId: string;
  name: string;
  stream: MediaStream;
};

// STUN handles most connections; TURN relays media through a server when a
// peer is behind a strict NAT/corporate firewall (STUN-only would fail there).
// Defaults to the free Open Relay TURN; override with NEXT_PUBLIC_TURN_* env vars.
const TURN_SERVERS: RTCIceServer[] = process.env.NEXT_PUBLIC_TURN_URL
  ? [
      {
        urls: process.env.NEXT_PUBLIC_TURN_URL,
        username: process.env.NEXT_PUBLIC_TURN_USERNAME,
        credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
      },
    ]
  : [
      { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
    ];

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }, ...TURN_SERVERS],
};

export default function ScreenShare({ roomId, userId = "guest", userName = "Guest", onShareStart, variant = "toolbar" }: Props) {
  const panel = variant === "panel";
  const [sharing, setSharing] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Unique per mount (tab/window) identity so the same user can share and
  // watch across two windows without the signaling confusing them.
  const selfIdRef = useRef<string>("");

  const createPeerConnection = useCallback(
    (peerId: string, peerName: string) => {
      if (pcsRef.current.has(peerId)) return pcsRef.current.get(peerId)!;

      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcsRef.current.set(peerId, pc);

      // Add local tracks if we're sharing
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          channelRef.current?.send({
            type: "broadcast",
            event: "ice",
            payload: { target: peerId, candidate: e.candidate, from: selfIdRef.current },
          });
        }
      };

      pc.ontrack = (e) => {
        const stream = e.streams[0];
        setPeers((prev) => {
          const existing = prev.find((p) => p.userId === peerId);
          if (existing) {
            return prev.map((p) => (p.userId === peerId ? { ...p, stream } : p));
          }
          return [...prev, { userId: peerId, name: peerName, stream }];
        });
      };

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === "disconnected" ||
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          pcsRef.current.delete(peerId);
          setPeers((prev) => prev.filter((p) => p.userId !== peerId));
        }
      };

      return pc;
    },
    [],
  );

  // Setup signaling channel
  useEffect(() => {
    const pcs = pcsRef.current;
    // Generate the per-mount identity here (not during render) so the value is
    // never evaluated in a static prerender.
    if (!selfIdRef.current) {
      selfIdRef.current = `${userId}:${Math.random().toString(36).slice(2)}`;
    }
    const selfId = selfIdRef.current;
    const channel = supabase.channel(`screenshare-${roomId}`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: "join" }, ({ payload }) => {
        if (payload.from === selfId) return;
        // If we're sharing, offer our stream to whoever joined (only once per peer).
        if (localStreamRef.current) {
          if (!pcsRef.current.has(payload.from)) {
            const pc = createPeerConnection(payload.from, payload.name);
            pc.createOffer().then((offer) => {
              pc.setLocalDescription(offer);
              channel.send({
                type: "broadcast",
                event: "offer",
                payload: { target: payload.from, sdp: offer, from: selfId, name: userName },
              });
            });
          }
        } else if (!payload.reply && !pcsRef.current.has(payload.from)) {
          // Viewer answering a join so any sharer in the room learns we're here
          // and starts the WebRTC handshake on their side. Replies are not
          // re-replied to, so this terminates.
          channel.send({
            type: "broadcast",
            event: "join",
            payload: { from: selfId, name: userName, reply: true },
          });
        }
      })
      .on("broadcast", { event: "offer" }, async ({ payload }) => {
        if (payload.target !== selfId) return;
        const pc = createPeerConnection(payload.from, payload.name);
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        channel.send({
          type: "broadcast",
          event: "answer",
          payload: { target: payload.from, sdp: answer, from: selfId },
        });
      })
      .on("broadcast", { event: "answer" }, async ({ payload }) => {
        if (payload.target !== selfId) return;
        const pc = pcsRef.current.get(payload.from);
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      })
      .on("broadcast", { event: "ice" }, async ({ payload }) => {
        if (payload.target !== selfId) return;
        const pc = pcsRef.current.get(payload.from);
        if (pc && payload.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        }
      })
      .on("broadcast", { event: "leave" }, ({ payload }) => {
        const pc = pcsRef.current.get(payload.from);
        if (pc) {
          pc.close();
          pcsRef.current.delete(payload.from);
        }
        setPeers((prev) => prev.filter((p) => p.userId !== payload.from));
      })
      .subscribe((status) => {
        // Announce join only once the channel has actually joined — messages
        // sent before SUBSCRIBED can be silently dropped.
        if (status === "SUBSCRIBED") {
          channel.send({
            type: "broadcast",
            event: "join",
            payload: { from: selfId, name: userName },
          });
        }
      });

    channelRef.current = channel;

    return () => {
      channel.send({
        type: "broadcast",
        event: "leave",
        payload: { from: selfIdRef.current },
      });
      supabase.removeChannel(channel);
      pcs.forEach((pc) => pc.close());
      pcs.clear();
    };
  }, [roomId, userId, userName, createPeerConnection]);

  const startSharing = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: true,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setSharing(true);
      setError(null);
      onShareStart?.();

      // If there are existing peers, add tracks to them
      pcsRef.current.forEach((pc) => {
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      });

      // Notify everyone
      channelRef.current?.send({
        type: "broadcast",
        event: "join",
        payload: { from: selfIdRef.current, name: userName },
      });

      // Handle user stopping via browser UI
      stream.getVideoTracks()[0].onended = () => {
        stopSharing();
      };
    } catch (err) {
      if (err instanceof Error && err.name !== "NotAllowedError") {
        setError("Could not start screen share. Please allow screen capture.");
      }
    }
  };

  const copyWatchLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/watch/${roomId}`);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const stopSharing = () => {
    // Tell viewers we're gone so they clean up their video feeds right away
    channelRef.current?.send({
      type: "broadcast",
      event: "leave",
      payload: { from: selfIdRef.current },
    });
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    pcsRef.current.forEach((pc) => pc.close());
    pcsRef.current.clear();
    setPeers([]);
    setLocalStream(null);
    setSharing(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {!sharing ? (
          <button
            onClick={startSharing}
            className={`flex items-center gap-1.5 ${
              panel
                ? "btn-primary px-5 py-3 text-base"
                : "btn-secondary px-3 py-1.5 text-sm"
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Share Screen
          </button>
        ) : (
          <button
            onClick={stopSharing}
            className={`flex items-center gap-1.5 rounded-lg bg-red-600 font-medium text-white shadow hover:bg-red-700 ${
              panel ? "px-5 py-3 text-base" : "px-3 py-1.5 text-sm"
            }`}
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            Stop Sharing
          </button>
        )}
        {sharing && (
          <span className={`text-slate-500 ${panel ? "text-sm" : "text-xs"}`}>
            {peers.length > 0 ? `${peers.length} watching` : "Waiting for viewers..."}
          </span>
        )}
        {panel && (
          <button
            onClick={copyWatchLink}
            className="btn-secondary ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm"
            title="Anyone with this link can watch the live stream without signing in"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656 0l-1.5-1.5m7.856-7.156l1.5 1.5m-4.243 2.5L15 11m-1.5-4.5L16.5 3.5a4 4 0 015.656 5.656L19 12" />
            </svg>
            {linkCopied ? "Link copied!" : "Copy watch link"}
          </button>
        )}
      </div>

      {error && <p className={`text-red-600 ${panel ? "text-sm" : "text-xs"}`}>{error}</p>}

      {/* Local preview so the sharer can see what they're streaming */}
      {panel && sharing && localStream && (
        <div className="flex w-full flex-col gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            Your stream
          </h3>
          <LocalPreview stream={localStream} />
        </div>
      )}

      {/* Remote screen feeds */}
      {peers.length > 0 && (
        <div className="flex w-full flex-col gap-3">
          {panel && (
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              Live streams ({peers.length})
            </h3>
          )}
          <div className={panel ? "grid gap-4 sm:grid-cols-2" : "flex flex-col gap-2"}>
            {peers.map((peer) => (
              <RemoteVideo key={peer.userId} peer={peer} />
            ))}
          </div>
        </div>
      )}

      {panel && !sharing && peers.length === 0 && (
        <p className="text-sm text-slate-400">
          No one is streaming right now — click “Share Screen” to start.
        </p>
      )}
    </div>
  );
}

function LocalPreview({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-black shadow">
      <div className="flex items-center gap-2 bg-indigo-600 px-3 py-1.5">
        <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
        <span className="text-xs font-medium text-white">You are sharing</span>
      </div>
      {/* muted to avoid audio echo against the captured screen audio */}
      <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full object-contain" />
    </div>
  );
}

function RemoteVideo({ peer }: { peer: Peer }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && peer.stream) {
      videoRef.current.srcObject = peer.stream;
    }
  }, [peer.stream]);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-black shadow">
      <div className="flex items-center gap-2 bg-slate-800 px-3 py-1.5">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        <span className="text-xs font-medium text-white">{peer.name}&apos;s screen</span>
      </div>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="aspect-video w-full object-contain"
      />
    </div>
  );
}
