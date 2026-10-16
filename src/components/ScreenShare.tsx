"use client";

import { useEffect, useRef, useState } from "react";
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
  /** null until the first media track arrives (shows "Connecting…"). */
  stream: MediaStream | null;
  /** Real WebRTC state — the stream object exists before any media flows. */
  state: "connecting" | "connected" | "failed";
};

/** A peer connection plus ICE candidates that arrived before the remote description. */
type Link = {
  pc: RTCPeerConnection;
  pending: RTCIceCandidateInit[];
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
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    ...TURN_SERVERS,
  ],
};

/*
 * Signaling design (Supabase broadcast channel, one per room):
 *
 * Every connection is one-directional: the SHARER creates the offer and sends
 * media, the VIEWER answers and only receives. Each client therefore keeps two
 * maps — `outgoing` (peers I send my screen to) and `incoming` (peers whose
 * screen I watch) — so two people can share at once without offer "glare".
 *
 *  hello   {from,name,to?}   "I'm here / please (re)send me your stream"
 *  sharing {from,name}       "I just started sharing" → others reply with hello
 *  offer   {from,to,name,sdp}
 *  answer  {from,to,sdp}
 *  ice     {from,to,dir,candidate}  dir = "out" when sent by the sharer side
 *  stopped {from}            sharer stopped → viewers drop that feed
 *  leave   {from}            client closed → drop everything for that peer
 */
export default function ScreenShare({ roomId, userId = "guest", userName = "Guest", onShareStart, variant = "toolbar" }: Props) {
  const panel = variant === "panel";
  const [sharing, setSharing] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [viewerCount, setViewerCount] = useState(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const outgoingRef = useRef<Map<string, Link>>(new Map());
  const incomingRef = useRef<Map<string, Link>>(new Map());
  const connectedViewersRef = useRef<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Unique per mount (tab/window) identity so the same user can share and
  // watch across two windows without the signaling confusing them.
  const selfIdRef = useRef<string>("");
  const userNameRef = useRef(userName);
  const onShareStartRef = useRef(onShareStart);
  // Set by the signaling effect so the handlers below can use its helpers.
  const apiRef = useRef<{ stop: () => void; announceShare: () => void } | null>(null);

  useEffect(() => {
    userNameRef.current = userName;
    onShareStartRef.current = onShareStart;
  });

  // Setup signaling channel
  useEffect(() => {
    const outgoing = outgoingRef.current;
    const incoming = incomingRef.current;
    const connectedViewers = connectedViewersRef.current;
    // Generate the per-mount identity here (not during render) so the value is
    // never evaluated in a static prerender.
    if (!selfIdRef.current) {
      selfIdRef.current = `${userId}:${Math.random().toString(36).slice(2)}`;
    }
    const selfId = selfIdRef.current;
    const channel = supabase.channel(`screenshare-${roomId}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;
    let disposed = false;

    const send = (event: string, payload: Record<string, unknown>) => {
      void channel.send({ type: "broadcast", event, payload: { from: selfId, ...payload } });
    };

    const syncViewers = () => setViewerCount(connectedViewers.size);

    const closeLink = (map: Map<string, Link>, peerId: string) => {
      const link = map.get(peerId);
      if (!link) return;
      link.pc.onicecandidate = null;
      link.pc.ontrack = null;
      link.pc.onconnectionstatechange = null;
      link.pc.close();
      map.delete(peerId);
    };

    const flushPending = async (link: Link) => {
      const queued = link.pending.splice(0);
      for (const c of queued) {
        try {
          await link.pc.addIceCandidate(c);
        } catch {
          /* stale candidate — ignore */
        }
      }
    };

    // ---- Sharer side: send my screen to one viewer ----
    const offerTo = async (peerId: string) => {
      const stream = localStreamRef.current;
      if (!stream) return;
      const existing = outgoing.get(peerId);
      if (existing) {
        const s = existing.pc.connectionState;
        // Healthy or still connecting → leave it alone (duplicate hello).
        if (s !== "failed" && s !== "closed" && s !== "disconnected") return;
        closeLink(outgoing, peerId);
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);
      const link: Link = { pc, pending: [] };
      outgoing.set(peerId, link);

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // Keep text sharp: prefer resolution over framerate and allow a high bitrate.
      pc.getSenders().forEach((sender) => {
        if (sender.track?.kind !== "video") return;
        const params = sender.getParameters();
        params.degradationPreference = "maintain-resolution";
        if (!params.encodings?.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = 4_000_000;
        sender.setParameters(params).catch(() => {});
      });

      pc.onicecandidate = (e) => {
        if (e.candidate) send("ice", { to: peerId, dir: "out", candidate: e.candidate.toJSON() });
      };
      pc.onconnectionstatechange = () => {
        if (outgoing.get(peerId) !== link) return;
        if (pc.connectionState === "connected") {
          connectedViewers.add(peerId);
          syncViewers();
        } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          connectedViewers.delete(peerId);
          closeLink(outgoing, peerId);
          syncViewers();
        }
      };

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send("offer", { to: peerId, name: userNameRef.current, sdp: pc.localDescription });
      } catch {
        closeLink(outgoing, peerId);
      }
    };

    // ---- Viewer side: receive one sharer's screen ----
    const dropPeer = (peerId: string) => {
      closeLink(incoming, peerId);
      setPeers((prev) => prev.filter((p) => p.userId !== peerId));
    };

    const handleOffer = async (peerId: string, name: string, sdp: RTCSessionDescriptionInit) => {
      // A fresh offer replaces any previous connection from this sharer.
      closeLink(incoming, peerId);

      const pc = new RTCPeerConnection(RTC_CONFIG);
      const link: Link = { pc, pending: [] };
      incoming.set(peerId, link);

      setPeers((prev) =>
        prev.some((p) => p.userId === peerId)
          ? prev.map((p) => (p.userId === peerId ? { ...p, name, stream: null, state: "connecting" } : p))
          : [...prev, { userId: peerId, name, stream: null, state: "connecting" }],
      );

      pc.onicecandidate = (e) => {
        if (e.candidate) send("ice", { to: peerId, dir: "in", candidate: e.candidate.toJSON() });
      };
      pc.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        setPeers((prev) => prev.map((p) => (p.userId === peerId ? { ...p, stream } : p)));
        e.track.addEventListener("unmute", () =>
          setPeers((prev) => prev.map((p) => (p.userId === peerId ? { ...p, state: "connected" } : p))),
        );
      };
      const setState = (state: Peer["state"]) =>
        setPeers((prev) => prev.map((p) => (p.userId === peerId ? { ...p, state } : p)));
      pc.onconnectionstatechange = () => {
        if (incoming.get(peerId) !== link || disposed) return;
        console.info(`[screenshare] viewer connection to ${peerId}: ${pc.connectionState}`);
        if (pc.connectionState === "connected") setState("connected");
        else if (pc.connectionState === "failed") {
          // Show the failure, then ask the sharer for a fresh offer.
          setState("failed");
          closeLink(incoming, peerId);
          setTimeout(() => {
            if (!disposed) send("hello", { to: peerId, name: userNameRef.current });
          }, 3000);
        } else if (pc.connectionState === "closed") {
          dropPeer(peerId);
        }
      };
      // Never leave a viewer stuck on a black box: flag it if ICE hasn't connected in 15s.
      setTimeout(() => {
        if (!disposed && incoming.get(peerId) === link && pc.connectionState !== "connected") {
          console.warn(`[screenshare] still not connected after 15s (ice: ${pc.iceConnectionState})`);
          setState("failed");
        }
      }, 15000);

      try {
        await pc.setRemoteDescription(sdp);
        await flushPending(link);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send("answer", { to: peerId, sdp: pc.localDescription });
      } catch {
        dropPeer(peerId);
      }
    };

    channel
      .on("broadcast", { event: "hello" }, ({ payload }) => {
        if (payload.from === selfId) return;
        if (payload.to && payload.to !== selfId) return;
        if (localStreamRef.current) void offerTo(payload.from);
      })
      .on("broadcast", { event: "sharing" }, ({ payload }) => {
        if (payload.from === selfId) return;
        // Someone started sharing — tell them we're here so they send us their stream.
        send("hello", { to: payload.from, name: userNameRef.current });
      })
      .on("broadcast", { event: "offer" }, ({ payload }) => {
        if (payload.to !== selfId) return;
        void handleOffer(payload.from, payload.name ?? "Someone", payload.sdp);
      })
      .on("broadcast", { event: "answer" }, async ({ payload }) => {
        if (payload.to !== selfId) return;
        const link = outgoing.get(payload.from);
        if (!link || link.pc.signalingState !== "have-local-offer") return;
        try {
          await link.pc.setRemoteDescription(payload.sdp);
          await flushPending(link);
        } catch {
          closeLink(outgoing, payload.from);
        }
      })
      .on("broadcast", { event: "ice" }, async ({ payload }) => {
        if (payload.to !== selfId || !payload.candidate) return;
        // Candidates from the sharer ("out") belong to my incoming link, and vice versa.
        const link = (payload.dir === "out" ? incoming : outgoing).get(payload.from);
        if (!link) return;
        if (!link.pc.remoteDescription) {
          link.pending.push(payload.candidate);
          return;
        }
        try {
          await link.pc.addIceCandidate(payload.candidate);
        } catch {
          /* stale candidate — ignore */
        }
      })
      .on("broadcast", { event: "stopped" }, ({ payload }) => {
        dropPeer(payload.from);
      })
      .on("broadcast", { event: "leave" }, ({ payload }) => {
        dropPeer(payload.from);
        closeLink(outgoing, payload.from);
        connectedViewers.delete(payload.from);
        syncViewers();
      })
      .subscribe((status) => {
        // Announce ourselves only once the channel has actually joined —
        // messages sent before SUBSCRIBED can be silently dropped.
        if (status === "SUBSCRIBED") send("hello", { name: userNameRef.current });
      });

    apiRef.current = {
      announceShare: () => send("sharing", { name: userNameRef.current }),
      stop: () => {
        send("stopped", {});
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
        outgoing.forEach((_, id) => closeLink(outgoing, id));
        connectedViewers.clear();
        syncViewers();
        setLocalStream(null);
        setSharing(false);
      },
    };

    return () => {
      disposed = true;
      send("leave", {});
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      outgoing.forEach((_, id) => closeLink(outgoing, id));
      incoming.forEach((_, id) => closeLink(incoming, id));
      connectedViewers.clear();
      supabase.removeChannel(channel);
      channelRef.current = null;
      apiRef.current = null;
    };
  }, [roomId, userId]);

  const stopSharing = () => apiRef.current?.stop();

  const startSharing = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("Your browser doesn't support screen sharing. Try desktop Chrome, Edge or Firefox.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } },
        audio: true,
      });
      // "detail" tells the encoder this is text/UI content, not camera video.
      stream.getVideoTracks().forEach((t) => {
        if ("contentHint" in t) t.contentHint = "detail";
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setSharing(true);
      setError(null);
      onShareStartRef.current?.();

      // Browser's own "Stop sharing" bar ends the track.
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        if (localStreamRef.current === stream) apiRef.current?.stop();
      });

      // Everyone in the room replies with hello, and we offer to each of them.
      apiRef.current?.announceShare();
    } catch (err) {
      if (err instanceof Error && err.name !== "NotAllowedError" && err.name !== "AbortError") {
        setError("Could not start screen share. Please allow screen capture.");
      }
    }
  };

  const copyWatchLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/watch/${roomId}`);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setError("Couldn't copy the link — copy it from the address bar instead.");
    }
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
            {viewerCount > 0 ? `${viewerCount} watching` : "Waiting for viewers..."}
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
          <div className={panel ? `grid gap-4 ${peers.length > 1 ? "sm:grid-cols-2" : ""}` : "flex flex-col gap-2"}>
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
  const boxRef = useRef<HTMLDivElement>(null);
  // Browsers block autoplay for unmuted video without a user gesture — a guest
  // landing directly on a watch link has none, so the video stays paused on a
  // black first frame. Start muted (autoplay always allowed) and unmute via a
  // user gesture.
  const [muted, setMuted] = useState(true);
  const [hasAudio, setHasAudio] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !peer.stream) return;
    video.srcObject = peer.stream;
    video.play().catch(() => {});

    const stream = peer.stream;
    const update = () => setHasAudio(stream.getAudioTracks().length > 0);
    update();
    stream.addEventListener("addtrack", update);
    stream.addEventListener("removetrack", update);
    return () => {
      stream.removeEventListener("addtrack", update);
      stream.removeEventListener("removetrack", update);
    };
  }, [peer.stream]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void boxRef.current?.requestFullscreen?.();
  };

  return (
    <div ref={boxRef} className="relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-black shadow">
      <div className="flex items-center gap-2 bg-slate-800 px-3 py-1.5">
        <span className={`h-2 w-2 rounded-full ${peer.state === "connected" ? "bg-red-500" : peer.state === "failed" ? "bg-slate-500" : "animate-pulse bg-amber-400"}`} />
        <span className="text-xs font-medium text-white">{peer.name}&apos;s screen</span>
        <div className="ml-auto flex items-center gap-1">
          {hasAudio && (
            <button
              onClick={() => setMuted((m) => !m)}
              className="rounded-md px-1.5 py-0.5 text-xs text-white/80 transition hover:bg-white/10 hover:text-white"
              title={muted ? "Unmute stream audio" : "Mute stream audio"}
            >
              {muted ? "🔇 Muted" : "🔊"}
            </button>
          )}
          <button
            onClick={toggleFullscreen}
            className="rounded-md px-1.5 py-0.5 text-xs text-white/80 transition hover:bg-white/10 hover:text-white"
            title="Fullscreen"
          >
            ⛶
          </button>
        </div>
      </div>
      <div className="relative flex-1 bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className="aspect-video w-full object-contain"
        />
        {peer.state === "failed" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center text-sm text-white/80">
            <span>Couldn&apos;t connect to this stream.</span>
            <span className="text-xs text-white/50">
              A firewall or network is blocking the direct link. Retrying… (a working TURN server fixes this)
            </span>
          </div>
        ) : (
          (!peer.stream || peer.state === "connecting") && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/70">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Connecting…
            </div>
          )
        )}
      </div>
    </div>
  );
}
