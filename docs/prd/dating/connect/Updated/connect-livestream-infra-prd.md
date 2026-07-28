# Technical PRD — Self-Hosted Live Streaming Infrastructure
# "Connect Live" Streaming Platform · Provider Abstraction · Agentic DevOps
### Inside the Spotlight / Paymax super-app ecosystem

| Field | Value |
|---|---|
| Scope | Self-hosted streaming stack for Connect + all super-app livestream features |
| Interactive plane | **LiveKit** (Apache 2.0, self-hosted) — host + co-hosts + active gifters/voters |
| Scale plane | **LL-HLS** via **Ant Media (Community) / OvenMediaEngine / SRS** behind a **CDN** — passive viewers |
| Switchability | Admin-controlled **Streaming Provider Gateway** to flip between self-hosted combo ↔ **Agora** ↔ other existing WebRTC providers |
| Operations | **Swarm of DevOps agents** (agentic SRE/AIOps) for continuous, policy-bounded scaling & stability |
| Shared services | Super-app SSO/Auth, RBAC, Wallet, Map, existing Agora integration |
| Status | Draft v1.0 — for development & infra planning |
| Owner | `<<Platform / Infra Lead>>` |

> Companion to the **Connect PRD** (consumer screens) and the **Connect strategy prompt**. This document specifies the *infrastructure and operations* beneath the live-streaming features (screens LV-/LB- in the Connect PRD).

---

## 1. Objectives & non-goals
**Objectives**
1. Run live streaming on **owned infrastructure** to control per-viewer cost (especially Nigerian-scale egress) while keeping interactive latency <500 ms.
2. Cleanly **separate two media planes** — interactive (WebRTC/LiveKit) and broadcast-scale (LL-HLS/CDN) — and bridge them.
3. Make the streaming provider a **runtime-switchable choice** (self-hosted combo vs Agora vs other WebRTC providers) controllable by Admin per market, cohort, stream type, or as failover.
4. Operate the whole stack with a **swarm of DevOps agents** that keep it scalable and stable under strict guardrails, GitOps, and audit — humans approve high-risk/high-cost actions.
5. Integrate natively with the super-app: **SSO auth, RBAC/tier gating, wallet (gifts/votes), Map**, and **NDPA-compliant** recording.

**Non-goals (this phase):** building a new consumer UI (covered in Connect PRD); replacing the wallet/auth; multi-CDN bidding (later); a from-scratch SFU (we adopt LiveKit).

## 2. Architecture overview

Two media planes plus a control plane and an ops plane.

```
                         ┌──────────────────────── CONTROL PLANE ────────────────────────┐
                         │  Streaming Provider Gateway (SPG)  ·  Token Broker  ·  Routing │
                         │  Policy Engine  ·  Feature Flags  ·  RBAC/Tier checks          │
                         └───────────────┬───────────────────────────────┬───────────────┘
                                         │ (unified internal API + SDK)   │
        ┌────────────────────────────────┴───────┐            ┌───────────┴───────────────────────────┐
        │        INTERACTIVE PLANE (low-latency)  │   bridge  │        SCALE PLANE (passive viewers)    │
        │                                         │  (egress) │                                        │
        │  Host / Co-hosts / on-"stage" gifters   │  RTMP/SRT │  LL-HLS Origin (Ant Media / OME / SRS)  │
        │            │  WebRTC  ▲                  │  ───────▶ │   → ABR transcode ladder → LL-HLS/CMAF  │
        │            ▼          │                  │           │            │                            │
        │   ┌──────────────────────────┐          │           │            ▼                            │
        │   │  LiveKit SFU cluster      │          │           │      CDN (West-Africa PoPs)            │
        │   │  + Redis + LiveKit Egress │──────────┘           │            │                            │
        │   │  + LiveKit Ingress        │                      │            ▼                            │
        │   │  + coturn (TURN/STUN)     │                      │     Viewers (HLS.js / ExoPlayer /      │
        │   └──────────────────────────┘                      │              AVPlayer, audio-only opt)  │
        │     ▲  Agora / other WebRTC adapters (alt path)      │                                        │
        └─────┼───────────────────────────────────────────────┴────────────────────────────────────────┘
              │
   ┌──────────┴───────────────────────── OPS PLANE (agentic DevOps) ───────────────────────────────────┐
   │  Agent Orchestrator → {Deployment, Autoscaling, Self-Healing, Incident, Cost, Security, Chaos} agents│
   │  acting via GitOps PRs + scoped action APIs · OPA policy guardrails · approval queue · full audit    │
   │  on K8s (KEDA/Karpenter) · Prometheus/Thanos · Grafana · Loki · Tempo/OTel · ArgoCD · Terraform      │
   └────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Interactive plane — LiveKit
- **LiveKit SFU cluster** carries the real-time "stage": broadcaster, co-hosts, PK opponents, and viewers who actively participate (gifters/voters who need instant reaction). WebRTC, sub-500 ms.
- **Redis** backs multi-node room distribution and state.
- **LiveKit Ingress** accepts RTMP/WHIP from external encoders (e.g., a creator using OBS) into a room.
- **LiveKit Egress** does two jobs: (a) **recording** rooms for VOD, and (b) **republishing** the room composite (or a single track) to **RTMP/SRT** — this is the **bridge** into the scale plane.
- **coturn** provides TURN/STUN for NAT traversal (mandatory on mobile networks).
- **Auth:** short-lived **JWT access tokens** minted by the Token Broker after SSO + RBAC/tier check (only Tier 2+ may publish/go live).

### 2.2 Scale plane — LL-HLS origin + CDN
- The egress RTMP/SRT feed lands on an **LL-HLS origin**: **Ant Media Community**, **OvenMediaEngine**, or **SRS** (one chosen primary; the other two are interchangeable fallbacks — all are open-source and support RTMP-in / LL-HLS-out).
- Origin produces an **adaptive bitrate (ABR) ladder** (e.g., 1080p/720p/480p/240p + **audio-only**) for data-cost-sensitive Nigerian networks.
- A **CDN with West-African PoPs** (e.g., Cloudflare Lagos) fronts the origin so per-viewer cost collapses to cheap cached HLS egress; origin only serves cache-fill.
- Players: **HLS.js** (web), **ExoPlayer** (Android), **AVPlayer** (iOS), with an explicit **audio-only / data-saver** path.

### 2.3 Why this split
Active stage participants are few (host + a handful of co-hosts/gifters) → expensive WebRTC is fine. The large passive crowd → cheap CDN-cached LL-HLS at 2–5 s latency. This is the cost-control core of the design.

## 3. Streaming Provider Gateway (the admin "switch")

A single **internal abstraction** so the Connect app and super-app never call a provider SDK directly — they call the **Gateway**, which selects and brokers the actual provider.

### 3.1 Components
- **Unified Streaming SDK/API** (client + server): `createStage`, `joinStage`, `publish`, `startBroadcast`, `getViewerPlayback`, `sendReactionChannel`, `endStage`. Stable contract regardless of provider.
- **Provider Adapters** (pluggable): `LiveKitAdapter` (+ scale-plane bridge), `AgoraAdapter`, `GenericWebRTCAdapter` (for other existing providers). Each adapter implements the same interface and maps to provider primitives.
- **Token Broker**: mints provider-specific session credentials *after* super-app SSO + RBAC/tier authorization; clients never hold provider keys.
- **Routing Policy Engine**: decides which provider serves a given session.
- **Feature-flag & config store**: drives routing at runtime without redeploy.

### 3.2 Routing dimensions (admin-configurable)
| Dimension | Example policy |
|---|---|
| **Market/region** | Nigeria → self-hosted; market without local infra → Agora |
| **Stream type** | PK battle / multi-guest → LiveKit; simple 1:many → either |
| **Cohort / % rollout** | 10% of creators on self-hosted (canary), rest on Agora |
| **Health / failover** | If self-hosted SLO breached → auto-fail over to Agora |
| **Cost** | Route to cheapest provider meeting quality threshold |
| **Per-creator override** | Pin a VIP creator to a specific provider |

### 3.3 Switching behaviors
- **Default + override hierarchy:** global default → region → stream type → cohort → per-creator override.
- **Hot switch (new sessions):** changing a policy routes *new* stages to the new provider immediately.
- **Failover (in-flight):** on provider health failure, new joins reroute; existing sessions get a graceful reconnect prompt (seamless mid-stream migration is a later differentiator, not MVP).
- **Shadow / A-B:** run a cohort on self-hosted while measuring QoE vs Agora before wider rollout.
- **Kill-switch:** one Admin action reverts an entire market to a known-good provider.

### 3.4 Data model (config)
`streaming_provider` (id, type, status, regions[], credentials_ref) · `routing_rule` (scope, match, provider_id, priority, enabled) · `provider_health` (provider_id, region, slo_state, updated_at) · `stage_session` (id, provider_id, room_ref, egress_ref, tier_gate, created_by). All changes **audit-logged** and RBAC-gated (only Platform Admin / Super-Admin).

## 4. Agentic DevOps — the "swarm"

A set of **specialized, policy-bounded autonomous agents** under an **orchestrator** that keep the platform scalable and stable. **Core principle: agents act through GitOps pull requests and scoped, audited action APIs — never by free-handed mutation of production.** High-risk or high-cost actions require human approval; everything is dry-runnable, reversible, and logged.

### 4.1 Agent roster
| Agent | Watches | Acts (within policy) | Human gate? |
|---|---|---|---|
| **Orchestrator** | All agent signals, global state | Coordinates, dedupes, sequences actions, enforces blast-radius caps | — |
| **Deployment agent** | CI artifacts, GitOps repo | Opens/promotes canary→prod PRs (build-once-deploy-many), runs smoke tests, auto-rollback on canary metric breach | Auto within canary policy; manual for major version |
| **Autoscaling/Capacity agent** | LiveKit participant/track load, origin transcode load, CDN offload, forecast | Scales SFU nodes (KEDA on participants/node), origin transcoders, node pools (Karpenter); pre-warms before predicted peaks | Auto within min/max bounds; manual to raise ceilings |
| **Self-Healing agent** | Health/readiness, crash loops, stuck rooms | Restarts/cordons nodes, drains, reschedules, clears stuck egress jobs | Auto within rate limits |
| **Incident/SRE agent** | SLO burn rate, alerts, traces | Correlates, runs runbooks, triggers failover via SPG, drafts incident timeline, pages on-call | Auto mitigations only; declares SEV with human |
| **Cost/FinOps agent** | Egress, instance spend, provider cost per session | Recommends/triggers cost-routing in SPG, rightsizes, schedules spot, flags waste | Recommends; auto only under spend cap |
| **Security/Compliance agent** | CVE scans, config drift, IAM, network policy, secret age | Opens patch PRs, blocks non-compliant deploys (OPA/Gatekeeper), forces secret rotation, flags NDPA/residency drift | Auto for low-risk; manual for prod IAM |
| **Chaos/Resilience agent** | Steady-state SLOs | Runs scheduled fault injection in staging (and bounded prod game-days), verifies graceful degradation & restore | Manual to enable prod experiments |
| **Capacity-Forecast agent** | Historical + event calendar (e.g., big creator, BBNaija-style night) | Produces scaling forecasts feeding Autoscaling agent | — |

### 4.2 Guardrails (non-negotiable)
- **Policy-as-code (OPA/Gatekeeper):** every agent action validated against policy before execution; denials are logged.
- **Blast-radius limits:** max nodes/min, max spend/hour, max % of fleet touched per window, one region at a time.
- **Change via GitOps:** infra/config changes are PRs to version-controlled repos (Terraform/Helm/Argo) — reproducible and reviewable; agents can auto-merge only within whitelisted, low-risk paths.
- **Human-in-the-loop queue:** risky/expensive/destructive actions land in an Admin **approval queue** with diff, rationale, and predicted impact.
- **Dry-run + rollback:** every action has a simulated plan and a defined revert; "roll forward only" is never the sole option.
- **Full audit:** who/what/when/why for every agent action, immutable, queryable from Admin.
- **Kill-switch:** disable any agent or the whole swarm instantly; system falls back to standard HPA/manual ops.

### 4.3 Platform the agents operate on
Kubernetes (EKS, **af-south-1** primary) · **KEDA** (event/metric scaling) + **Karpenter** (node provisioning) · **ArgoCD/Flux** (GitOps) · **Terraform** (IaC) · **Prometheus/Thanos + Grafana** (metrics) · **Loki** (logs) · **Tempo/OpenTelemetry** (traces) · **OPA/Gatekeeper** (policy) · **Falco** (runtime security) · secrets in **Vault** with **OIDC/workload identity** (no long-lived keys).

## 5. Scalability & reliability

### 5.1 Scaling model
- **LiveKit (interactive):** stateless-ish workers coordinated via Redis; scale on **participants/tracks per node** and CPU. Rooms distribute across nodes; co-host/PK rooms pinned with headroom. KEDA scales pods; Karpenter adds nodes.
- **Egress/bridge:** scale egress workers with concurrent active broadcasts (each live stage that fans out to HLS consumes one egress job).
- **LL-HLS origin:** scale on **distinct streams × ABR ladder** (transcode is the cost); CDN absorbs viewer fan-out, so origin stays small relative to audience.
- **CDN:** the real scale lever for passive viewers; near-linear cheap egress, cache-hit ratio is the KPI.

### 5.2 Multi-region & edge (Africa-first)
Primary compute in **AWS af-south-1 (Cape Town)**; evaluate **Lagos** local DC / interconnect (Rack Centre, MainOne) for ingest proximity; **CDN PoPs in West Africa** for delivery. Route users to nearest healthy region; degrade to audio-only on poor networks.

### 5.3 SLOs (symptom-based, user-felt)
| SLI | Target |
|---|---|
| Stage join success | ≥ 99.5% |
| Interactive glass-to-glass latency | < 500 ms p95 |
| HLS start latency | < 4 s p95 |
| HLS rebuffer ratio | < 1.5% |
| Broadcast start success | ≥ 99% |
| Platform uptime | ≥ 99.9% monthly |
| Failover time (provider) | < 30 s for new sessions |

Alerts fire on **SLO burn rate**, owned and actionable; deploys are annotated on dashboards.

### 5.4 Resilience
Health/readiness probes everywhere; timeouts, retries-with-backoff, circuit breakers between planes; graceful degradation (interactive plane failing must not kill HLS playback); **backups of stateful stores (config, recordings metadata) with tested restores**; rehearsed DR.

## 6. Security & compliance
- **Token auth:** short-lived JWTs minted post-SSO; **publish gated by RBAC + KYC Tier 2+**; ephemeral TURN credentials.
- **Network:** least-privilege security groups, segmented VPC, restricted egress, WAF + DDoS protection (CDN edge) on all public endpoints.
- **Secrets:** Vault; OIDC workload identity; rotation enforced by the Security agent.
- **Recording/VOD:** encrypted at rest; **NDPA-aligned** retention, consent, and data-residency rules codified in IaC and policy (not just documented).
- **RBAC integration:** consumer publish rights via tier; Admin actions (provider switch, agent approvals, infra) scoped to Platform Admin / Compliance / Super-Admin roles; all audited.
- **Abuse:** stream moderation hooks (from Connect PRD), token revocation, and rate limits to stop hijack/relay abuse.

## 7. Observability
Three pillars plus **media QoE**: join time, publish/subscribe latency, packet loss, jitter, freeze rate, ABR switches, rebuffer ratio, CDN cache-hit, egress GB. Per-service golden-signal dashboards (LiveKit, egress, origin, CDN, SPG). Provider-comparison dashboard (self-hosted vs Agora QoE & cost) feeds routing decisions. Distributed tracing across SPG → adapter → media plane.

## 8. CI/CD & IaC
- **Build once, deploy many:** immutable images tagged by commit SHA, promoted dev → staging → prod; config/secrets differ per env, not builds.
- Pipeline: install → lint → unit → build → integration → security/dependency scan → publish → deploy staging → smoke → **gated** prod (canary).
- **Progressive delivery:** canary/blue-green with automated metric gates and **rehearsed rollback**.
- **IaC via PR** (Terraform + Helm + Argo); state secured/locked, separated per env.
- **Migrations** (for SPG/config DB): backward-compatible **expand/contract**, decoupled from dependent code, tested at prod-like volume.
- Definition-of-done enforced: artifact promoted, scans pass, IaC in VC, secrets in vault, rollback defined, observability + one symptom alert per service, backups+restore tested, changes audited.

## 9. Cost & FinOps model
- **Cost driver = egress + transcode**, not licenses (LiveKit/OME/SRS/Ant Media Community are free).
- **Interactive plane** cost scales with *active stage participants* (small N) — contained.
- **Passive plane** cost ≈ CDN egress × concurrent viewers × bitrate; **maximize cache-hit** and **push audio-only** to cut data.
- Provide a **per-1,000-concurrent-viewer model** comparing: self-hosted (origin+CDN) vs Agora per-minute, per region — this is the input to the Cost agent's routing.
- Spot/ARM (Graviton) for transcode where safe; rightsizing by the Cost agent; spend caps as hard guardrails.

## 10. Admin Console additions (extends Connect Admin PRD §11)
| ID | Screen | Purpose |
|---|---|---|
| ALS-01 | Streaming providers | List providers, health, regions, enable/disable |
| ALS-02 | Routing policy editor | Build/prioritize routing rules (region/type/cohort/cost) |
| ALS-03 | Provider failover & kill-switch | Manual failover, revert market to known-good provider |
| ALS-04 | Live infra dashboard | LiveKit nodes, egress jobs, origins, CDN offload, regions |
| ALS-05 | Stream QoE & compare | QoE + cost: self-hosted vs Agora vs others |
| ALS-06 | Recording / VOD management | Recordings, retention, NDPA controls |
| ADV-01 | DevOps agent console | Agent status, health, enable/disable, kill-switch |
| ADV-02 | Agent approval queue | Review/approve/deny risky agent actions (diff + impact) |
| ADV-03 | Agent audit log | Immutable record of all agent actions |
| ADV-04 | Capacity & forecast | Scaling forecasts, event pre-warm scheduling |
| ADV-05 | Cost/FinOps dashboard | Egress/spend, routing cost impact, caps |
| ADV-06 | Policy (OPA) management | View/edit guardrail policies, denials |

## 11. Integration contracts
- **Connect app ↔ SPG:** unified Streaming SDK (stage create/join/publish/playback/reactions). App is provider-agnostic.
- **SPG ↔ Auth/RBAC:** token mint requires valid SSO session + tier check.
- **SPG ↔ Wallet:** gifting/voting events ride a reaction/data channel that the wallet service settles (real-money transfer per Connect PRD); media plane carries the *signal*, wallet carries the *money*.
- **SPG ↔ Map:** geo-based stream discovery and region routing.
- **Ops plane ↔ everything:** read-only telemetry + scoped action APIs; GitOps repos as the change surface.

## 12. Rollout & coexistence with Agora
1. **Phase 0 — Abstraction first:** ship the SPG with the **AgoraAdapter** wrapping the *existing* integration. Zero behavior change; everything routes to Agora. (De-risks by decoupling app from provider.)
2. **Phase 1 — Self-host in staging:** stand up LiveKit + origin + CDN + ops plane; load-test; validate SLOs.
3. **Phase 2 — Canary:** route a small Nigerian creator cohort to self-hosted via routing rules; compare QoE & cost on ALS-05.
4. **Phase 3 — Expand:** raise the percentage by market as SLO + cost parity hold; Agora remains automatic failover.
5. **Phase 4 — Default self-hosted (Nigeria):** self-hosted default in-market; other providers reserved for failover, specific stream types, or markets without local infra.
**Gate:** no expansion step proceeds unless SLOs hold and the rollback/failover path is rehearsed.

## 13. Risks & open questions
- **Egress cost at scale** — model early; cache-hit and audio-only adoption are decisive.
- **Self-hosted ops maturity** — the agent swarm reduces toil but needs strong guardrails and an on-call backstop until proven.
- **Mid-stream provider migration** — seamless in-flight switch is hard; MVP does graceful reconnect, not zero-glitch handoff.
- **Origin engine choice** — pick one primary (Ant Media Community vs OME vs SRS) via a staged bake-off on latency, ABR, ops, and SDK fit; keep the others as documented fallbacks.
- **Local edge** — confirm Lagos DC/interconnect economics vs af-south-1-only.
- **Agent autonomy boundaries** — finalize which actions are ever auto vs always human-gated; default conservative.
- **Open:** exact CDN vendor & West-Africa PoP coverage; recording retention period under NDPA; LiveKit node sizing per concurrent stage.

## 14. Glossary
SFU — Selective Forwarding Unit · WHIP/WHEP — WebRTC ingest/egress signaling · LL-HLS — Low-Latency HLS · ABR — Adaptive Bitrate · SPG — Streaming Provider Gateway · KEDA — Kubernetes event-driven autoscaler · Karpenter — node autoscaler · OPA — Open Policy Agent · GitOps — git-as-source-of-truth ops · QoE — Quality of Experience · NDPA — Nigeria Data Protection Act · af-south-1 — AWS Cape Town region.

---
*Pick the primary LL-HLS origin via a staged bake-off, confirm CDN West-Africa coverage and NDPA retention with counsel, and keep agent autonomy conservative until SLOs are proven in production.*
