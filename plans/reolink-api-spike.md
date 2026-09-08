# Spike: camera-to-cloud video pipeline without on-site custom hardware

Status: **design settled through research + discussion, not yet validated against real hardware**

## Goal

Today's (planned) architecture has a Raspberry Pi running a custom "recorder" service that pulls an RTSP stream from a court's camera, cuts a clip for the session's time window, and uploads it to our own S3 bucket — see `plans/nestjs-migration.md` for how the API's `RecorderClientService`/webhook contract talks to that service.

We don't want to run our own on-site hardware-with-custom-software (a Pi we build, deploy, and maintain). This doc lays out the architecture we've settled on to avoid that, why several other options were rejected, and what still needs to be verified against real hardware before committing.

Explicitly **not in scope**: how we serve clips to customers. That's already built (`GET /v1/sessions/:id/presigned_download` in `api/`) and doesn't change no matter how the clip gets into S3.

Camera under test: **Reolink RP-PCB8MZ** (PoE) / **RP-WCB8MZ** (WiFi sibling, same 8MP/5x-zoom spec) — see the recommended architecture below for why we're now leaning WiFi despite PoE being more reliable in isolation.

## Recommended architecture

**On-site, per court/facility:**
- The camera (Reolink, WiFi model) — configured once (recording schedule, FTPS destination), then operates autonomously.
- A dedicated WiFi access point placed close to the court, wired back to the facility's existing network. Off-the-shelf hardware, configured once via its own app, no custom software.
- One cable run from that AP to existing network infrastructure (often already in place at the facility).

**Recording**: continuous or fixed-interval recording (e.g. every 60 seconds), **not** motion-triggered (motion detection had a reported reliability gap) and **not** dependent on an on-demand "start recording" API call. The camera is always capturing; the session start/stop API calls don't command the camera at all — they just record timestamps.

**Upload**: FTPS (encrypted, outbound-only from the camera — no port-forwarding or inbound exposure needed). This is an officially documented, first-class Reolink feature — not a reverse-engineered one.

**Upload destination**: a managed FTPS-to-S3 gateway. AWS Transfer Family is the reference option (~$216/month per always-on protocol endpoint, shared across every camera using it, + $0.04/GB transferred); cheaper third-party alternatives (Files.com, ftpgrid.com — the latter markets itself specifically for Reolink) should be priced out before committing.

**Retention & legal narrowing**: uploads land in a staging S3 bucket/prefix with an **S3 Lifecycle Policy** that auto-deletes everything after a few hours — no custom cleanup code. A lightweight S3-event-triggered Lambda matches each upload's timestamp against known session windows (from our own `sessions` data) and **copies** matching segments into permanent storage. Everything else — footage of anyone who isn't part of a paid, consented session — simply expires automatically within hours. This narrows legal exposure by construction: nothing is retained or served beyond what an explicit booking actually covers.

**Serving to customers**: unchanged. `GET /v1/sessions/:id/presigned_download`, already built.

**Monitoring**: a lightweight health check tracking the last successful upload timestamp per camera, alerting if one goes quiet during a facility's open hours. No camera has zero failure rate — the goal is catching a dead camera fast, not preventing failure entirely.

## Final bill of materials — what's genuinely eliminated vs. what's unavoidable

The distinction that matters isn't "does any hardware exist" (a camera is inherently hardware) — it's "does anything run custom software we have to build, deploy, and keep alive." That's what made the Pi a problem, and it's the thing actually eliminated here.

| Needed | Not needed |
|---|---|
| The camera itself | Raspberry Pi |
| A WiFi access point (off-the-shelf, configure-once) | Any on-site custom software |
| A cable from the AP to existing network infra | NVR/DVR box |
| AWS Transfer Family (or similar managed gateway) | Anything needing remote SSH access to debug |
| S3 (staging bucket w/ lifecycle policy + permanent bucket) | Anything needing a physical site visit to fix |
| A Lambda function (matches uploads to sessions) | |
| Our existing NestJS API (unchanged) | |

Everything with actual logic in it (matching, retention, serving) runs as software in our own cloud — the same kind of engineering we already do, triggered by an S3 event instead of an HTTP request.

## Why we rejected the alternatives we looked at

- **On-demand recording via the camera's API** (`SetManualRec`/`SetRecV20`): exists, but it's part of Reolink's unofficial, reverse-engineered command set, with real reports of unreliable behavior (a Home Assistant integration thread reports the manual-record toggle misbehaving). It would also introduce a real-time dependency — if the "start recording" call is slow or fails, we lose the first seconds of a session. Confirmed via Eagle Eye Networks' actual API (`/exports`, `/downloads` with start-time/end-time parameters) that **this isn't how professional camera platforms work anyway** — even enterprise-grade systems record continuously and retrieve by time range, they don't trigger recording on command. We're following that same proven pattern, just building the retrieval/matching layer ourselves instead of paying a platform for it.
- **Reolink Cloud ("My Cloud" subscription)**: stores motion-triggered clips on Reolink's own servers, but there's no public third-party API to retrieve from it — access is app/web-UI only. Dead end for this purpose.
- **Reolink's local CGI `Download` command** (pulling a specific recorded file by name, as opposed to FTPS push): community reports say this is inconsistent across models/firmware — some devices have no working path to the actual video bytes at all. Superseded by FTPS, which is officially documented and doesn't have this risk.
- **Wiring every camera directly (PoE) instead of using WiFi + local access points**: PoE avoids WiFi-specific reliability issues entirely, but running Ethernet cable throughout an existing facility is expensive, slow, and disruptive — often the largest line-item cost in a real installation. The WiFi-to-nearby-dedicated-AP design gets most of the reliability benefit (the documented Reolink WiFi complaints are about weak/distant signal and facility-network quirks, both of which a dedicated nearby AP directly addresses) without the cabling burden.
- **Enterprise camera platforms as the primary plan** (Eagle Eye Networks, Verkada, Cisco Meraki MV): all viable, all use the same continuous-record/retrieve-by-time-range pattern with an officially supported API instead of Reolink's FTPS. Verkada ($699–$5,299/camera hardware + $199–$1,799/camera/year) and Meraki (~$180–330/camera/year license + hardware) are priced for enterprise security budgets — likely overkill here. Eagle Eye Networks (~$5–50/camera/month) is the closest cost fit and is kept as **Plan B** if the Reolink+FTPS approach doesn't hold up in testing.

## Legal — explicit blocking item, not a footnote

Not legal advice; get real counsel before launch. Key considerations surfaced during this investigation:
- **Video vs. audio are treated very differently.** Many US states require *all* parties' consent for audio recording (two-party/all-party consent states), a much stricter bar than video alone. Reolink cameras have a built-in mic — **disable audio recording** (or handle it as a separate, explicit consent) unless the product actually needs it.
- **Who's captured matters, not just the paying customer.** A booked session likely includes teammates, opponents, spectators, kids — people who never agreed to anything. The retention architecture above (only footage matching a paid session is ever kept beyond a few hours) is the mitigation: everyone else's footage evaporates automatically rather than being retained or monetized.
- **Minors** raise the sensitivity further if used for youth sports.
- **GDPR/international regimes** apply if we ever serve EU customers/venues — video of identifiable people is personal data there, with a much larger compliance framework attached.
- Established practice among companies already doing sports recording/broadcasting for youth/amateur leagues (this isn't a novel business model) generally includes: visible venue signage, a recording-consent clause in the facility's own booking/membership terms, audio disabled by default, recording scoped tightly to the paid window, and a clear retention/deletion policy — which is exactly the shape of the architecture above.

## Open questions the spike must still verify against real hardware

1. **Does FTPS upload on a fixed interval actually work reliably** on the RP-WCB8MZ/RP-PCB8MZ's current firmware, over multiple days (not a quick demo)? Motion-triggered FTP had a reported reliability complaint — confirm interval-based upload doesn't share it.
2. **What happens when an upload attempt fails mid-transfer** (e.g. a brief WiFi hiccup)? Does the camera retry, buffer to its SD card and catch up, or silently drop that segment? This determines how much WiFi reliability actually matters in practice — a retry/buffer behavior means an occasional drop costs a few seconds, not a whole session.
3. **Does a dedicated, nearby access point actually resolve the documented WiFi complaints** (weak signal, offline incidents), tested with real throughput under continuous-upload load — not assumed from specs.
4. **Confirm the filename/timestamp convention** Reolink's FTPS client uses, so the Lambda matching logic can reliably map an uploaded file to a session window.
5. **Size real bandwidth/storage cost** per camera for continuous upload — consider a lower-resolution sub-stream if full 4K is unnecessarily expensive to run all day.
6. **Price a cheaper FTPS-to-S3 gateway than AWS Transfer Family** (Files.com, ftpgrid.com, others) before committing to the ~$216/month baseline.
7. **Legal review**, per above — blocking, not parallelizable with the technical work.

## Deliverable

A findings write-up (this doc, updated with an "Outcome" section) recommending one of:
- **Adopt**: the architecture above holds up under multi-day real-world testing — build it.
- **Partial**: works but with caveats (e.g. WiFi+AP isn't reliable enough, fall back to PoE for courts where cabling is feasible) — mixed rollout.
- **Reject**: reliability doesn't hold up even with a dedicated AP and retry/buffer behavior, or legal counsel rules out the retention approach — fall back to Eagle Eye Networks (Plan B) instead of building this ourselves.

Not a deliverable: production code. This is validation work; implementation is separate, larger follow-up work.

## Time-box

Suggest 3–5 days given the addition of a real multi-day soak test (up from the original 2–3), gated on having real hardware (camera + access point) on a test network. Legal review can run in parallel with the technical validation.
