"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/lib/useUser";
import { useCollaboration } from "@/lib/useCollaboration";
import { Cursors, OnlineAvatars } from "@/components/Presence";
import ScreenShare from "@/components/ScreenShare";
import Recorder from "@/components/Recorder";
import type { Whiteboard } from "@/lib/types";

type WBElement = {
  id: string;
  type: "freehand" | "rect" | "ellipse" | "line" | "text" | "sticky";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  x2?: number;
  y2?: number;
  points?: { x: number; y: number }[];
  text?: string;
  color?: string;
  fill?: string;
  size?: number;
  strokeWidth?: number;
};

type VP = { x: number; y: number; scale: number };
type Point = { x: number; y: number };

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const PALETTE = ["#0f172a", "#ef4444", "#f97316", "#eab308", "#22c55e", "#0ea5e9", "#6366f1", "#a855f7", "#ec4899", "#ffffff"];
const TOOLS = [
  { id: "select", label: "Select", icon: "↖" },
  { id: "hand", label: "Hand", icon: "✋" },
  { id: "pen", label: "Pen", icon: "✏️" },
  { id: "rect", label: "Rectangle", icon: "▭" },
  { id: "ellipse", label: "Ellipse", icon: "◯" },
  { id: "line", label: "Line", icon: "╱" },
  { id: "text", label: "Text", icon: "T" },
  { id: "sticky", label: "Sticky", icon: "📝" },
  { id: "eraser", label: "Eraser", icon: "🧽" },
] as const;

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

export default function WhiteboardView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const user = useUser();
  const [name, setName] = useState("Whiteboard");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [showRecordings, setShowRecordings] = useState(false);
  const [recordings, setRecordings] = useState<any[]>([]);
  const [tool, setTool] = useState<string>("select");
  const [strokeColor, setStrokeColor] = useState("#0f172a");
  const [fillColor, setFillColor] = useState("#fef08a");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const elementsRef = useRef<WBElement[]>([]);
  const draftRef = useRef<WBElement | null>(null);
  const selectedRef = useRef<Set<string>>(new Set());
  const viewportRef = useRef<VP>({ x: 0, y: 0, scale: 1 });
  const interactionRef = useRef<any>(null);
  const spaceRef = useRef(false);
  const autoSaveTimer = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const undoStack = useRef<WBElement[][]>([]);
  const redoStack = useRef<WBElement[][]>([]);
  const isInteractingRef = useRef(false);
  const [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "live" | "offline">("connecting");

  const scheduleRender = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(render);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // defined later via refs to access closures; assign
  const renderRef = useRef<() => void>(() => {});

  function render() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // background
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, w, h);

    const vp = viewportRef.current;
    // grid
    const step = 40 * vp.scale;
    const offX = vp.x % step;
    const offY = vp.y % step;
    ctx.fillStyle = "rgba(148,163,184,0.45)";
    for (let x = offX; x < w; x += step) {
      for (let y = offY; y < h; y += step) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.save();
    ctx.translate(vp.x, vp.y);
    ctx.scale(vp.scale, vp.scale);

    const drawEl = (el: WBElement, isDraft = false) => {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = el.color || "#0f172a";
      ctx.fillStyle = el.fill || "transparent";
      ctx.lineWidth = (el.strokeWidth || 2) / vp.scale * vp.scale / vp.scale; // keep world units
      // Actually line width in world: store as world, so no divide
      ctx.lineWidth = el.strokeWidth || 2;
      switch (el.type) {
        case "freehand": {
          const pts = el.points || [];
          if (pts.length === 0) return;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length - 1; i++) {
            const xc = (pts[i].x + pts[i + 1].x) / 2;
            const yc = (pts[i].y + pts[i + 1].y) / 2;
            ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
          }
          const last = pts[pts.length - 1];
          ctx.lineTo(last.x, last.y);
          ctx.stroke();
          break;
        }
        case "rect": {
          const x = el.x || 0, y = el.y || 0, ww = el.width || 0, hh = el.height || 0;
          if (el.fill && el.fill !== "transparent") {
            ctx.fillRect(x, y, ww, hh);
          }
          ctx.strokeRect(x, y, ww, hh);
          break;
        }
        case "ellipse": {
          const x = el.x || 0, y = el.y || 0, ww = el.width || 0, hh = el.height || 0;
          ctx.beginPath();
          ctx.ellipse(x + ww / 2, y + hh / 2, Math.abs(ww) / 2, Math.abs(hh) / 2, 0, 0, Math.PI * 2);
          if (el.fill && el.fill !== "transparent") ctx.fill();
          ctx.stroke();
          break;
        }
        case "line": {
          ctx.beginPath();
          ctx.moveTo(el.x || 0, el.y || 0);
          ctx.lineTo(el.x2 || 0, el.y2 || 0);
          ctx.stroke();
          break;
        }
        case "text": {
          ctx.font = `${el.size || 24}px var(--font-geist-sans), sans-serif`;
          ctx.fillStyle = el.color || "#0f172a";
          ctx.textBaseline = "top";
          ctx.fillText(el.text || "", el.x || 0, el.y || 0);
          break;
        }
        case "sticky": {
          const x = el.x || 0, y = el.y || 0, ww = el.width || 180, hh = el.height || 140;
          ctx.fillStyle = el.fill || "#fef08a";
          ctx.fillRect(x, y, ww, hh);
          ctx.strokeRect(x, y, ww, hh);
          ctx.fillStyle = "#1e293b";
          ctx.font = `14px var(--font-geist-sans), sans-serif`;
          ctx.textBaseline = "top";
          const lines = (el.text || "").split("\n");
          lines.forEach((ln, i) => ctx.fillText(ln, x + 10, y + 10 + i * 18));
          break;
        }
      }
      if (isDraft) {
        ctx.globalAlpha = 0.6;
      }
    };

    (elementsRef.current || []).forEach((el) => drawEl(el));
    if (draftRef.current) drawEl(draftRef.current, true);
    ctx.globalAlpha = 1;

    // selection
    selectedRef.current.forEach((sid) => {
      const el = elementsRef.current.find((e) => e.id === sid);
      if (!el) return;
      const b = boundsOf(el);
      ctx.strokeStyle = "#6366f1";
      ctx.lineWidth = 1.5 / vp.scale;
      ctx.setLineDash([6 / vp.scale, 4 / vp.scale]);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.setLineDash([]);
      // handles
      const hs = handles(b, vp.scale);
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#6366f1";
      hs.forEach((h) => {
        ctx.fillRect(h.x - h.s / 2, h.y - h.s / 2, h.s, h.s);
        ctx.strokeRect(h.x - h.s / 2, h.y - h.s / 2, h.s, h.s);
      });
    });

    ctx.restore();
  }

  function boundsOf(el: WBElement) {
    if (el.type === "freehand") {
      const pts = el.points || [];
      if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      pts.forEach((p) => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    if (el.type === "text") {
      const size = el.size || 24;
      const w = (el.text || "").length * size * 0.6;
      return { x: el.x || 0, y: el.y || 0, w, h: size };
    }
    if (el.type === "line") {
      const x = Math.min(el.x || 0, el.x2 || 0), y = Math.min(el.y || 0, el.y2 || 0);
      return { x, y, w: Math.abs((el.x2 || 0) - (el.x || 0)), h: Math.abs((el.y2 || 0) - (el.y || 0)) };
    }
    const x = el.x || 0, y = el.y || 0, w = el.width || 0, h = el.height || 0;
    if (w < 0) { /* normalize not stored */ }
    return { x: w < 0 ? x + w : x, y: h < 0 ? y + h : y, w: Math.abs(w), h: Math.abs(h) };
  }

  function handles(b: { x: number; y: number; w: number; h: number }, scale: number) {
    const s = 8 / scale;
    const pts = [
      { x: b.x, y: b.y }, { x: b.x + b.w / 2, y: b.y }, { x: b.x + b.w, y: b.y },
      { x: b.x + b.w, y: b.y + b.h / 2 }, { x: b.x + b.w, y: b.y + b.h },
      { x: b.x + b.w / 2, y: b.y + b.h }, { x: b.x, y: b.y + b.h },
      { x: b.x, y: b.y + b.h / 2 },
    ];
    return pts.map((p) => ({ x: p.x, y: p.y, s }));
  }

  function hitTest(el: WBElement, p: Point): boolean {
    const b = boundsOf(el);
    if (el.type === "freehand") {
      const pts = el.points || [];
      for (let i = 0; i < pts.length - 1; i++) {
        if (segDist(pts[i], pts[i + 1], p) < 8 / viewportRef.current.scale) return true;
      }
      return segDist2(pts[0], p) < (8 / viewportRef.current.scale) ** 2;
    }
    if (el.type === "line") {
      return segDist({ x: el.x || 0, y: el.y || 0 }, { x: el.x2 || 0, y: el.y2 || 0 }, p) < 8 / viewportRef.current.scale;
    }
    return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  }

  function segDist(a: Point, b: Point, p: Point) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const cx = a.x + t * dx, cy = a.y + t * dy;
    return Math.hypot(p.x - cx, p.y - cy);
  }
  function segDist2(a: Point, p: Point) { return (a.x - p.x) ** 2 + (a.y - p.y) ** 2; }

  function screenToWorld(px: number, py: number): Point {
    const vp = viewportRef.current;
    return { x: (px - vp.x) / vp.scale, y: (py - vp.y) / vp.scale };
  }

  function scheduleSave() {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => saveNow(), 800);
  }

  async function saveNow() {
    setSaving(true);
    const payload = { elements: elementsRef.current };
    const { data } = await supabase.from("whiteboards").update({ data: payload }).eq("id", id).select();
    if (data?.[0]?.updated_at) setLastRemoteUpdate(data[0].updated_at);
    setSaving(false);
    setSavedAt(Date.now());
  }

  function pushUndo(before: WBElement[]) {
    undoStack.current.push(clone(before));
    redoStack.current = [];
  }

  function commitElements(next: WBElement[], before?: WBElement[]) {
    if (before) pushUndo(before);
    elementsRef.current = next;
    setSelectedCount(selectedRef.current.size);
    scheduleRender();
    scheduleSave();
  }

  function handleUndo() {
    if (undoStack.current.length === 0) return;
    redoStack.current.push(clone(elementsRef.current));
    elementsRef.current = undoStack.current.pop() as WBElement[];
    selectedRef.current.clear();
    setSelectedCount(0);
    scheduleRender();
    scheduleSave();
  }

  function handleRedo() {
    if (redoStack.current.length === 0) return;
    undoStack.current.push(clone(elementsRef.current));
    elementsRef.current = redoStack.current.pop() as WBElement[];
    scheduleRender();
    scheduleSave();
  }

  // load
  const [lastRemoteUpdate, setLastRemoteUpdate] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("whiteboards").select("*").eq("id", id).single();
      if (error) return;
      setName(data.name);
      setTeamId(data.team_id);
      setLastRemoteUpdate(data.updated_at);
      const els = (data.data && (data.data as any).elements) || [];
      elementsRef.current = els;
      undoStack.current = [];
      redoStack.current = [];
      scheduleRender();
    })();
  }, [id, scheduleRender]);

  // realtime data sync — when a teammate saves, pull their elements into the canvas
  useEffect(() => {
    const channel = supabase
      .channel(`wb-sync-${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "whiteboards", filter: `id=eq.${id}` },
        ({ new: row }) => {
          // Skip our own saves (matched by updated_at) and any update that arrives mid-interaction
          if (row.updated_at === lastRemoteUpdate) return;
          if (isInteractingRef.current) return;
          setLastRemoteUpdate(row.updated_at);
          if (row.name) setName(row.name);
          const els = (row.data && (row.data as any).elements) || [];
          elementsRef.current = els;
          selectedRef.current.clear();
          setSelectedCount(0);
          setEditingId(null);
          scheduleRender();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRealtimeStatus("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setRealtimeStatus("offline");
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, lastRemoteUpdate, scheduleRender]);

  // presence + cursors for this whiteboard
  const wbCollab = useCollaboration(`wb-${id}`, user?.id, user?.email?.split("@")[0] || "Someone", () => {});

  // fetch recordings for this whiteboard
  const loadRecordings = useCallback(async () => {
    const { data } = await supabase
      .from("recordings")
      .select("*")
      .eq("whiteboard_id", id)
      .order("created_at", { ascending: false });
    setRecordings(data ?? []);
  }, [id]);

  useEffect(() => {
    if (showRecordings) loadRecordings();
  }, [showRecordings, loadRecordings]);

  // resize canvas
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
      scheduleRender();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // space key
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const ae = document.activeElement;
      const editingText = ae && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT");
      if (e.code === "Space" && !e.repeat && !editingText && editingId === null) { spaceRef.current = true; e.preventDefault(); }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedRef.current.size > 0 && editingId === null) {
          const before = clone(elementsRef.current);
          elementsRef.current = elementsRef.current.filter((el) => !selectedRef.current.has(el.id));
          selectedRef.current.clear();
          setSelectedCount(0);
          commitElements(elementsRef.current, before);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo(); else handleUndo();
      }
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") spaceRef.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [editingId]);

  // pointer handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      isInteractingRef.current = true;
      const rect = canvas.getBoundingClientRect();
      const sp = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const wp = screenToWorld(sp.x, sp.y);
      const isPan = spaceRef.current || tool === "hand" || e.button === 1 || e.button === 2;
      if (isPan) {
        interactionRef.current = { mode: "pan", startX: sp.x, startY: sp.y, viewport: clone(viewportRef.current) };
        return;
      }

      if (tool === "pen") {
        const el: WBElement = { id: uid(), type: "freehand", points: [wp], color: strokeColor, strokeWidth };
        draftRef.current = el;
        interactionRef.current = { mode: "draw", before: clone(elementsRef.current) };
        scheduleRender();
        return;
      }

      if (tool === "rect" || tool === "ellipse" || tool === "line") {
        const el: WBElement = tool === "line"
          ? { id: uid(), type: "line", x: wp.x, y: wp.y, x2: wp.x, y2: wp.y, color: strokeColor, strokeWidth }
          : { id: uid(), type: tool as any, x: wp.x, y: wp.y, width: 0, height: 0, color: strokeColor, fill: "transparent", strokeWidth };
        draftRef.current = el;
        interactionRef.current = { mode: "shape", start: wp, before: clone(elementsRef.current) };
        scheduleRender();
        return;
      }

      if (tool === "text") {
        const el: WBElement = { id: uid(), type: "text", x: wp.x, y: wp.y, text: "", color: strokeColor, size: 24 };
        const before = clone(elementsRef.current);
        elementsRef.current = [...elementsRef.current, el];
        selectedRef.current = new Set([el.id]);
        setSelectedCount(1);
        commitElements(elementsRef.current, before);
        setEditingId(el.id);
        setEditingText("");
        return;
      }

      if (tool === "sticky") {
        const el: WBElement = { id: uid(), type: "sticky", x: wp.x, y: wp.y, width: 180, height: 140, text: "", color: strokeColor, fill: fillColor, strokeWidth: 1 };
        const before = clone(elementsRef.current);
        elementsRef.current = [...elementsRef.current, el];
        selectedRef.current = new Set([el.id]);
        setSelectedCount(1);
        commitElements(elementsRef.current, before);
        setEditingId(el.id);
        setEditingText("");
        return;
      }

      if (tool === "select") {
        // find top
        let hit: WBElement | null = null;
        for (let i = elementsRef.current.length - 1; i >= 0; i--) {
          if (hitTest(elementsRef.current[i], wp)) { hit = elementsRef.current[i]; break; }
        }
        if (hit) {
          if (!e.shiftKey) selectedRef.current = new Set([hit.id]);
          else selectedRef.current.add(hit.id);
          setSelectedCount(selectedRef.current.size);
          // move
          const before = clone(elementsRef.current);
          interactionRef.current = {
            mode: "move",
            start: wp,
            before,
            originals: clone(elementsRef.current.filter((el) => selectedRef.current.has(el.id))),
          };
        } else {
          if (!e.shiftKey) { selectedRef.current.clear(); setSelectedCount(0); scheduleRender(); }
        }
        return;
      }

      if (tool === "eraser") {
        const before = clone(elementsRef.current);
        let changed = false;
        elementsRef.current = elementsRef.current.filter((el) => {
          if (hitTest(el, wp)) { changed = true; return false; }
          return true;
        });
        if (changed) {
          selectedRef.current.clear();
          setSelectedCount(0);
          commitElements(elementsRef.current, before);
        }
        interactionRef.current = { mode: "erase", initialBefore: before, changed };
        return;
      }
    };

    const onMove = (e: PointerEvent) => {
      const ia = interactionRef.current;
      if (!ia) {
        // eraser drag maybe
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const sp = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const wp = screenToWorld(sp.x, sp.y);

      if (ia.mode === "pan") {
        viewportRef.current = {
          x: ia.viewport.x + (sp.x - ia.startX),
          y: ia.viewport.y + (sp.y - ia.startY),
          scale: ia.viewport.scale,
        };
        scheduleRender();
        return;
      }

      if (ia.mode === "draw") {
        const d = draftRef.current as WBElement;
        d.points = [...(d.points || []), wp];
        scheduleRender();
        return;
      }

      if (ia.mode === "shape") {
        const d = draftRef.current as WBElement;
        if (d.type === "line") { d.x2 = wp.x; d.y2 = wp.y; }
        else { d.width = wp.x - d.x!; d.height = wp.y - d.y!; }
        scheduleRender();
        return;
      }

      if (ia.mode === "move") {
        const dx = wp.x - ia.start.x;
        const dy = wp.y - ia.start.y;
        const origMap = new Map(ia.originals.map((o: WBElement) => [o.id, o]));
        elementsRef.current = elementsRef.current.map((el) => {
          if (!selectedRef.current.has(el.id)) return el;
          const o = origMap.get(el.id) as WBElement | undefined;
          if (!o) return el;
          // move type-specific geometry below
          // General: store base points at interaction start; instead simpler: apply delta to original each move from start
          return applyMove(el, o, dx, dy);
        });
        scheduleRender();
        return;
      }

      if (ia.mode === "erase") {
        const before = ia.before;
        let changed = false;
        elementsRef.current = elementsRef.current.filter((el) => {
          if (hitTest(el, wp)) { changed = true; return false; }
          return true;
        });
        if (changed) {
          ia.changed = true;
          selectedRef.current.clear();
          setSelectedCount(0);
          scheduleRender();
        }
        return;
      }
    };

    const onUp = (e: PointerEvent) => {
      const ia = interactionRef.current;
      interactionRef.current = null;
      isInteractingRef.current = false;
      if (!ia) return;

      if (ia.mode === "pan") return;

      if (ia.mode === "draw" || ia.mode === "shape") {
        const d = draftRef.current;
        draftRef.current = null;
        if (d) {
          // discard if tiny
          let keep = true;
          if (d.type !== "freehand" && Math.abs(d.width || 0) < 3 && Math.abs(d.height || 0) < 3 && (d.type !== "line" || (Math.abs((d.x2||0)-(d.x||0)) < 3 && Math.abs((d.y2||0)-(d.y||0)) < 3))) {
            keep = false;
          }
          if (d.type === "freehand" && (d.points?.length || 0) < 2) keep = false;
          if (keep) {
            elementsRef.current = [...elementsRef.current, d];
            selectedRef.current = new Set([d.id]);
            setSelectedCount(1);
            commitElements(elementsRef.current, ia.before);
          } else {
            scheduleRender();
          }
        }
        return;
      }

      if (ia.mode === "move") {
        // push undo using before
        commitElements(elementsRef.current, ia.before);
        return;
      }

      if (ia.mode === "erase") {
        if (ia.changed) pushUndo(ia.initialBefore);
        redoStack.current = [];
        scheduleSave();
        return;
      }
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const world = screenToWorld(mx, my);
      const factor = e.deltaY < 0 ? 1.1 : 0.909;
      const vp = viewportRef.current;
      const newScale = Math.min(8, Math.max(0.1, vp.scale * factor));
      viewportRef.current = {
        x: mx - world.x * newScale,
        y: my - world.y * newScale,
        scale: newScale,
      };
      scheduleRender();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const onContext = (e: MouseEvent) => e.preventDefault();
    canvas.addEventListener("contextmenu", onContext);

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContext);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, strokeColor, fillColor, strokeWidth, scheduleRender]);

  function applyMove(el: WBElement, original: WBElement, dx: number, dy: number): WBElement {
    const cloneEl = clone(el);
    if (el.type === "freehand" && el.points && original.points) {
      const odx = original.points[0].x - original.points[0].x; // 0
      const base = original.points;
      cloneEl.points = base.map((p, i) => ({ x: p.x + dx, y: p.y + dy }));
    } else {
      if (cloneEl.x !== undefined) cloneEl.x = (original.x || 0) + dx;
      if (cloneEl.y !== undefined) cloneEl.y = (original.y || 0) + dy;
      if (cloneEl.x2 !== undefined) cloneEl.x2 = (original.x2 || 0) + dx;
      if (cloneEl.y2 !== undefined) cloneEl.y2 = (original.y2 || 0) + dy;
    }
    return cloneEl;
  }

  const editorScreenPos = (() => {
    if (!editingId) return null;
    const el = elementsRef.current.find((e) => e.id === editingId);
    if (!el) return null;
    const vp = viewportRef.current;
    const x = (el.x || 0) * vp.scale + vp.x;
    const y = (el.y || 0) * vp.scale + vp.y;
    const size = (el.size || (el.type === "sticky" ? 14 : 14)) * vp.scale;
    return { x, y, size, el };
  })();

  function updateEditingText(value: string) {
    setEditingText(value);
    if (!editingId) return;
    const el = elementsRef.current.find((e) => e.id === editingId);
    if (!el) return;
    el.text = value;
    scheduleRender();
  }

  function finishEditing() {
    if (editingId) {
      setEditingId(null);
      scheduleSave();
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Header email={undefined} />
      <div className="flex h-[calc(100vh-4rem)] flex-col">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/80 px-3 py-2 backdrop-blur">
          <button onClick={() => router.push("/whiteboard")} className="btn-secondary px-3 py-1.5 text-sm">← Boards</button>
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={async () => { await supabase.from("whiteboards").update({ name }).eq("id", id); }} className="input max-w-[240px] py-1.5" />
          {teamId && (
            <div className="flex items-center gap-1.5">
              <ScreenShare roomId={id} userId={user?.id || ""} userName={user?.email?.split("@")[0] || "Someone"} />
              <Recorder teamId={teamId} whiteboardId={id} onRecordingSaved={loadRecordings} />
            </div>
          )}
          <div className="mx-2 h-6 w-px bg-slate-200" />
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm transition ${tool === t.id ? "bg-indigo-600 text-white shadow" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
              title={t.label}
            >
              {t.icon}
            </button>
          ))}
          <div className="mx-2 h-6 w-px bg-slate-200" />
          <div className="flex items-center gap-1">
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => { setStrokeColor(c); if (tool === "sticky") setFillColor(c); }}
                className={`h-6 w-6 rounded-full border-2 ${strokeColor === c ? "border-indigo-600" : "border-slate-300"}`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
          <select value={strokeWidth} onChange={(e) => setStrokeWidth(Number(e.target.value))} className="input max-w-[90px] py-1.5">
            {[1, 2, 3, 5, 8, 12].map((w) => <option key={w} value={w}>{w}px</option>)}
          </select>
          <div className="ml-auto flex items-center gap-2">
            <OnlineAvatars online={wbCollab.online} myId={user?.id} />
            <span className={`flex items-center gap-1 text-xs ${realtimeStatus === "live" ? "text-emerald-600" : realtimeStatus === "connecting" ? "text-amber-600" : "text-red-500"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${realtimeStatus === "live" ? "bg-emerald-500" : realtimeStatus === "connecting" ? "bg-amber-500 animate-pulse" : "bg-red-500"}`} />
              {realtimeStatus === "live" ? "Live" : realtimeStatus === "connecting" ? "Connecting" : "Offline"}
            </span>
            <span className="text-xs text-slate-500">{selectedCount > 0 ? `${selectedCount} selected` : " "}</span>
            <button onClick={handleUndo} className="btn-secondary px-3 py-1.5 text-sm">Undo</button>
            <button onClick={handleRedo} className="btn-secondary px-3 py-1.5 text-sm">Redo</button>
            <button onClick={() => { if (confirm("Clear board?")) { const before = clone(elementsRef.current); elementsRef.current = []; selectedRef.current.clear(); setSelectedCount(0); commitElements([], before); } }} className="btn-secondary px-3 py-1.5 text-sm">Clear</button>
            <button onClick={async () => { await saveNow(); }} className="btn-primary px-3 py-1.5 text-sm">{saving ? "Saving..." : "Save"}</button>
            <button onClick={() => setShowRecordings(true)} className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-sm">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Recordings ({recordings.length})
            </button>
            <button onClick={() => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              const link = document.createElement("a");
              link.download = `${name || "whiteboard"}.png`;
              link.href = canvas.toDataURL("image/png");
              link.click();
            }} className="btn-secondary px-3 py-1.5 text-sm">Export</button>
          </div>
        </div>

        {/* Canvas */}
        <div
          ref={containerRef}
          className="relative flex-1 overflow-hidden bg-slate-100"
          onPointerMove={(e) => {
            const rect = containerRef.current?.getBoundingClientRect();
            if (rect) wbCollab.sendCursor(e.clientX - rect.left, e.clientY - rect.top, "board");
          }}
          onPointerLeave={wbCollab.hideCursor}
        >
          <canvas ref={canvasRef} className="block touch-none" />
          <Cursors cursors={wbCollab.cursors} view="board" />
          {editorScreenPos && (
            <textarea
              autoFocus
              value={editingText}
              onChange={(e) => updateEditingText(e.target.value)}
              onBlur={finishEditing}
              onKeyDown={(e) => { if (e.key === "Escape") finishEditing(); }}
              style={{
                position: "absolute",
                left: editorScreenPos.x,
                top: editorScreenPos.y,
                fontSize: editorScreenPos.size,
                width: 260,
                minHeight: 40,
                zIndex: 30,
              }}
              className="rounded border border-indigo-400 bg-white/90 p-1 text-slate-900 outline-none"
            />
          )}
        </div>
        <div className="border-t border-slate-200 bg-white/70 px-3 py-1 text-xs text-slate-500">
          {saving ? "Saving…" : savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString()}` : "All changes save automatically"}
          {" · "}
          <span className={realtimeStatus === "live" ? "text-emerald-600" : realtimeStatus === "connecting" ? "text-amber-600" : "text-red-500"}>
            {realtimeStatus === "live" ? "Realtime on" : realtimeStatus === "connecting" ? "Realtime connecting…" : "Realtime offline"}
          </span>
          {" · Space+drag to pan · Wheel to zoom · Delete to remove selected"}
        </div>
      </div>

      {/* Recordings viewer panel */}
      {showRecordings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowRecordings(false)}>
          <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Recordings</h2>
              <button onClick={() => setShowRecordings(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-5">
              {recordings.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="text-4xl">&#127909;</div>
                  <p className="mt-3 text-sm text-slate-500">No recordings yet. Click &quot;Record&quot; to capture your screen.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {recordings.map((rec) => (
                    <RecordingItem key={rec.id} rec={rec} onDelete={loadRecordings} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordingItem({ rec, onDelete }: { rec: any; onDelete?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [urlError, setUrlError] = useState(false);

  useEffect(() => {
    supabase.storage
      .from("recordings")
      .createSignedUrl(rec.storage_path, 3600)
      .then(({ data, error }) => {
        if (error || !data?.signedUrl) {
          setUrlError(true);
        } else {
          setUrl(data.signedUrl);
        }
        setLoading(false);
      });
  }, [rec.storage_path]);

  const fmtDur = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const handleDelete = async () => {
    if (!confirm("Delete this recording?")) return;
    setDeleting(true);
    await supabase.storage.from("recordings").remove([rec.storage_path]);
    await supabase.from("recordings").delete().eq("id", rec.id);
    setDeleting(false);
    onDelete?.();
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5">
        <div>
          <p className="text-sm font-medium text-slate-800">{rec.name}</p>
          <p className="text-xs text-slate-400">{new Date(rec.created_at).toLocaleString()} - {fmtDur(rec.duration_seconds)}</p>
        </div>
        <div className="flex items-center gap-2">
          {url && (
            <a href={url} download={rec.name} className="btn-secondary px-3 py-1 text-xs">Download</a>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          >
            {deleting ? "..." : "Delete"}
          </button>
        </div>
      </div>
      {url && !urlError && (
        <video src={url} controls className="aspect-video w-full bg-black" />
      )}
      {urlError && (
        <div className="flex items-center justify-center bg-slate-900 py-8">
          <p className="text-sm text-slate-400">Video preview unavailable. Use the download button to watch.</p>
        </div>
      )}
    </div>
  );
}
