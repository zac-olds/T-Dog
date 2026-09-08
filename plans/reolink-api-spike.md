# Spike: Reolink software/API as a replacement for the Raspberry Pi recorder

Status: **draft — ready to hand to whoever has hardware access**

## Goal

Today's (planned) architecture has a Raspberry Pi running a custom "recorder" service that pulls an RTSP stream from the court's camera, cuts a clip for the session's time window, and uploads it to our own S3 bucket — see `plans/nestjs-migration.md` for how the API's `RecorderClientService`/webhook contract talks to that service.

This spike asks a narrower, concrete question than "can we talk to this camera at all": **can Reolink's own software/API do the "get a clip off the camera and into our hands" job well enough that we don't need to write and run our own RTSP-consuming, clip-cutting service?**

Explicitly **not** in scope: how we serve clips to customers. That's already built (`GET /v1/sessions/:id/presigned_download` in `api/`) and doesn't change no matter how the clip gets into S3 — this spike is only about the upload side.

Camera under test: **Reolink RP-PCB8MZ** (Professional Series, PoE, 8MP/4K, 5x optical zoom).

## What we already know (confirmed via Reolink's product page + community sources — not yet verified against real hardware)

- **Confirmed protocol support** (from the official spec sheet): RTSP, ONVIF, HTTP/HTTPS, UPnP, DDNS, P2P, FTP. So the camera itself isn't the limiting factor for local API access — it has one.
- **Local HTTP API exists**: JSON-over-HTTP POST to `/cgi-bin/api.cgi`, covering auth, system/network config, video/encoding settings, recording search & playback, PTZ, and AI/motion detection. This is Reolink's standard camera API, not something specific to this model.
- **The critical open risk**: community reports (Reolink community forum, GitHub projects reverse-engineering the API) say the `Search` command (list recordings by time range — metadata only) works broadly, but actually **downloading** the video file itself is inconsistent across models and firmware versions — on some devices there is reportedly no working network path to the actual video bytes at all (CGI Download, RTSP VOD, and ONVIF Replay have each been reported broken on specific models). This has **not** been checked against the RP-PCB8MZ specifically, and needs to be.
- **No official, current API documentation found.** The only Reolink-published CGI reference we found is a legacy PDF versioned 1.61 from 2017. Everything more current is community-reverse-engineered (e.g. `mnpg/Reolink_api_documentations`, `verheesj/reolink-api` on GitHub, various Python wrapper packages on PyPI). This means whatever we build against this API is **unsupported and undocumented by Reolink** — a real maintenance/reliability risk independent of whether it technically works today.
- **Reolink Cloud (the "My Cloud" subscription service) is a dead end for this purpose**: it stores motion-triggered clips on Reolink's own servers, but we found no evidence of a public third-party API to programmatically list or download from it — access appears to be limited to the Reolink mobile app and web UI. Worth one direct confirmation from Reolink (see Step 0 below) before fully ruling it out, but don't assume it's viable.

## Questions this spike needs to answer

1. **Does Search actually return usable results**, and does **Download actually return real video bytes**, on the RP-PCB8MZ's current firmware? (This is the single most important question — everything else is moot if this doesn't work.)
2. If Download works: what format/codec/container do we get back, and does it need transcoding before we can serve it to customers as-is, or does it just drop into our existing S3 pipeline unchanged?
3. Can we reliably get a clip for a **specific time window** (a session's start/end), not just "whatever the camera happened to record"? Does that require configuring continuous recording, motion-triggered recording, or an on-demand recording command — and does the mode we pick affect SD card retention/overwrite timing enough to risk losing the window before we fetch it?
4. **Does this remove the need for a local device at all**, or just simplify what it has to do? Two sub-cases:
   - If the local API is only reachable on the camera's LAN: something still has to run there (a Pi or similar) — but its job becomes "call Search + Download over plain HTTP" instead of "consume RTSP and run ffmpeg," which is a real simplification even without eliminating the Pi.
   - If the camera can be safely made reachable from our cloud backend (DDNS + port forward, or a lightweight VPN) — could our own NestJS API call Search/Download directly, eliminating the Pi entirely? What's the actual security exposure of doing that (this echoes the port-forwarding security discussion already had for T-Dog generally — recheck it specifically for this model/firmware, since exposed HTTP APIs on IoT cameras are a known attack target).
5. **Auth & credential handling**: what does the local API require (username/password, session token, per-device secret?), and how would we store/rotate that per camera across many court installations.
6. **Get one explicit answer from Reolink** (support ticket or their developer/partner channel, not just community forums) on whether there's any officially supported path — local or cloud — for third-party clip retrieval on this model. Even a "no" is useful: it tells us we're building on an unsupported integration either way.

## Suggested investigation steps (needs a real RP-PCB8MZ on a real network)

This can't be resolved from documentation alone — the community reports are inconsistent enough (some cameras can download recordings, some can't) that it has to be tested against this exact model and firmware version.

0. Ask Reolink support/developer contacts directly whether there's an officially supported API path (local or cloud) for third-party clip retrieval on the RP-PCB8MZ. Get this in writing regardless of what step 1 finds.
1. Get the camera on a test network, note its firmware version, and hit `/cgi-bin/api.cgi` directly (curl/Postman is fine) to test, in order: `Login` → `GetAbility` (confirms what this specific device claims to support) → configure/trigger a short recording → `Search` (confirm it lists that recording) → `Download` (confirm it returns real video bytes, not an error).
2. If Download works, save a sample clip and confirm it plays / check its codec — that determines whether our existing S3 + presigned-download flow can serve it unmodified.
3. Test whether DDNS + port forward (or whatever remote-access method Reolink recommends) makes the local API reachable from outside the LAN, and get a rough read on what that exposes.
4. Write up findings against the numbered questions above and make a go/no-go call.

## Deliverable

A short findings write-up (this doc, updated with an "Outcome" section) recommending one of:
- **Adopt**: local API reliably delivers clips; replace the Pi's RTSP/ffmpeg logic with a much simpler HTTP-polling client (still runs locally, or possibly runs centrally if remote access checks out).
- **Partial**: works well enough for some things (e.g. confirms recording happened) but not reliable enough to trust for actual clip delivery — keep the RTSP-based recorder as the source of truth.
- **Reject**: Download doesn't reliably work on this model/firmware, or Reolink confirms there's no supported path — stick with the existing RTSP + Pi design.

Not a deliverable: production code. If the API checks out, a follow-up implementation would replace `RecorderClientService`'s counterpart (the external recorder) — that's separate, larger work, not part of this spike.

## Time-box

Suggest 2–3 days, gated entirely on having a physical RP-PCB8MZ on a test network — most of that is steps 0–2 above, which can't be shortened by more research since the answer isn't in any documentation we could find.
