# Productivy — Feature Roadmap

## Done

- [x] **Notifications** — Bell icon with unread badge, realtime via postgres_changes. Triggers: task assigned, column renamed, screen share started, recording saved.

## Next (priority order)

- [ ] **Room invite links** — Shareable URL so teammates can join a whiteboard/project in one click. (`?invite=token`)
- [ ] **Text chat panel** — Slide-out chat on whiteboard/project pages. Messages saved in Supabase, realtime sync.
- [ ] **Task comments** — Comment thread on each task card. Shows count on the card.
- [ ] **File attachments** — Upload files (screenshots, PDFs) to tasks via Supabase Storage.
- [ ] **Voice talk** — Push-to-talk or always-in voice channel using WebRTC (reuse ScreenShare signaling).
- [ ] **Reactions** — Emoji reactions on tasks and whiteboard elements (👍 ❓ ✅).
- [ ] **Session recap** — Auto-generated summary after a recording ends (timestamps + chat log).

## Notes

- All features use existing Supabase (realtime, storage, RLS) — no external paid services.
- Notifications are the foundation — everything below should push notifications when relevant.
