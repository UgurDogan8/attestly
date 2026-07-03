# Product Brief: Confluence Read Confirmation / Policy Acknowledgement App

> **Name:** "Acknowledge" — decided Jul 2026 (Marketplace collision check clean).
> **Platform:** Atlassian Forge (Confluence Cloud) — required for all new apps.
> **Prepared:** July 2026 · Based on live Atlassian Marketplace research.
> **Document set:** [PRD](./01_read_confirm_prd.md) · [Tech design](./02_read_confirm_tech_design.md) · [Data model](./03_read_confirm_data_model.md) · [UX flows](./04_read_confirm_ux_flows.md) · [Test plan](./05_read_confirm_test_plan.md)

---

## 1. The one-line pitch

A dead-simple, compliance-grade way to prove employees have **read and acknowledged** important Confluence pages (policies, SOPs, security guidelines) — with audit-ready reports auditors accept.

## 2. Why this idea (the thesis)

- **Compliance drives the purchase.** ISO 27001, SOC 2, and HIPAA require *proof* that staff read policies. This is a "must-have or fail the audit" buy that renews every audit cycle → high, recurring willingness to pay.
- **Junior-developer buildable.** Core is a macro + button, Forge Storage for records, an admin report, reminders, CSV/PDF export. No ML, no cross-project logic, no external infra.
- **The category is genuinely winnable** (see competition below): small, uncontested, zero reviews anywhere, and the biggest incumbent is a dying Connect app.

## 3. Competitive landscape (live Marketplace data, July 2026)

| App | Vendor | Installs | Platform | Last updated | Reviews |
|-----|--------|----------|----------|--------------|---------|
| QC Read and Understood | QC Analytics | ~322 | **Connect** (no badge) | Apr 2025 (stale) | 0 |
| Comala Read Confirmations | Appfire (Platinum) | ~284 | Forge (Cloud Fortified) | May 2026 | 0 |
| Read & Confirm | MiddleCore | ~17 | Forge | Jun 2026 (new) | 0 |
| Read Confirmations for Confluence | (unconfirmed) | ? | ? | ? | ? |
| avono Read Confirmations for Confluence | avono | ? | ? | ? | ? |

> avono's app (id 1210734) surfaced in a later search (Jul 2026) — a 5th competitor missed in the original sweep; capture its installs/platform/pricing alongside the §9.1 pricing research.

**Key takeaways:**
1. **No dominant player** — category leader has only ~322 installs.
2. **Zero reviews across the whole category** — no trust moat to overcome; first to 10 reviews wins social proof.
3. **The leader (QC) is a stale Connect app** — it will break at Connect end-of-support (Q4 2026; timeline confirmed against Atlassian's three-phase plan: new Connect listings blocked Sep 2025, Connect descriptor updates blocked since Mar 2026, end of support late 2026 = "use at your own risk"). ~322 users will be forced to migrate → capturable base.
4. **Appfire isn't defending** its entry (bolt-on, no marketing, no reviews).

**Honest ceiling:** small category (~1,000 total installs). Realistic outcome = low-to-mid four/five-figure ARR — right-sized for a first monetizable app, not a unicorn.

## 4. Target user

- **Buyer:** Compliance officer, IT/security admin, HR, or quality manager at a small/mid company (10–200 users) that runs on Confluence and faces an audit (ISO 27001 / SOC 2 / HIPAA / internal policy).
- **Pain today:** They either do this manually (spreadsheets + email), or pay for a heavy document-management suite that's overkill and expensive.

## 5. MVP feature list (v1 — ship this first)

**Must-have (the core loop):**
- [ ] **Confirmation macro** — drop on any page; renders an "I have read and understood this" button.
- [ ] **Record on click** — store `user + page ID + page version + timestamp` in Forge Storage.
- [ ] **Assign readers** — target specific users/groups who must confirm a page.
- [ ] **Admin dashboard** — per page/space: who confirmed, who's outstanding, % complete.
- [ ] **Audit export** — one-click CSV **and PDF** of the confirmation log — the artifact auditors want (PDF elevated to launch requirement, owner decision Jul 2026).

**Should-have (fast follow, key differentiators):**
- [ ] **Re-confirmation on change** — when a page is edited to a new version, prior confirmations expire and re-prompt (critical for compliance correctness).
- [ ] **Reminder nudges** — scheduled email/in-app reminders to non-confirmers before a deadline.
- [ ] **Deadlines / campaigns** — set a due date per acknowledgement drive.

**Explicitly OUT of v1 scope (avoid scope creep):**
- Full document-workflow/approval engine (that's Comala's bloat — we win by *not* being that).
- Jira integration, cross-space rollups, e-signature legal certification — later, if demand appears.

## 6. Differentiation / how we win

1. **Free tier for ≤10 users** — none of the incumbents advertise one clearly; use it to seed installs + reviews.
2. **Audit-readiness as the headline** — lead with "export the report your auditor accepts," including page version + timestamp per confirmation.
3. **QC migration angle** — target QC Read and Understood's orphaned users: "Your read-confirmation app runs on Connect and stops working in 2026. Switch to a Forge-native app in minutes." Build a simple importer if feasible; time messaging to Atlassian's in-product Connect banners.
4. **Simplicity** — one thing, done cleanly. The buyer who wants *just this* shouldn't have to buy a workflow suite.

## 7. Pricing (research task — see §9)

- Incumbent pricing not visible without the pricing tab / logged-in view. **First research task:** capture QC and Comala per-user/month tiers.
- Likely model: **Free ≤10 users**, then per-user/month priced *below* the Appfire/Comala tier (undercut the enterprise incumbent, land the SMB long tail). Atlassian takes ~15%+ revenue share.

## 8. Build breakdown for the junior developer

| Phase | Work | Forge modules / APIs | Est. |
|-------|------|----------------------|------|
| 0. Setup | Forge CLI, dev site, `forge create`, deploy hello-world macro | Forge CLI, Custom UI or UI Kit | 2–3 days |
| 1. Core macro | Confirmation button on page; capture click → store record | `confluence:contentBylineItem` or macro; Forge Storage | 1 wk |
| 2. Data model | Record schema (user, pageId, version, timestamp); read/write helpers | Forge Storage (KV) | 3 days |
| 3. Admin dashboard | Per-page/space view of confirmed vs outstanding + % | Confluence global/space page module; REST API for user/page data | 1–1.5 wk |
| 4. Export | CSV + PDF export of the log | Client-side generation | 4–5 days |
| 5. Assign + reminders | Target users/groups; scheduled reminder emails | `scheduledTrigger`; product REST API | 1 wk |
| 6. Re-confirmation | Detect new page version → expire prior confirmations | Page-update webhook/trigger + version compare | 1 wk |
| 7. Polish + listing | Icons, screenshots, listing copy, privacy policy, security statement | Marketplace listing | 1 wk |

**Rough total:** ~6–8 weeks for a junior dev to a shippable v1.

> ⚠️ Reality check: building is ~30% of success. The other 70% is listing quality, first reviews, support responsiveness, and the QC-migration outreach. Budget time for go-to-market, not just code.

## 9. Immediate next steps

1. **Pricing research** (junior dev, ½ day): capture QC + Comala + Read & Confirm pricing tiers from their Marketplace pricing tabs.
2. **Confirm the 4th competitor** (Read Confirmations for Confluence, app id 1221972) — platform, installs, status.
3. **Validate the compliance angle** — find 2–3 target users (LinkedIn / r/atlassian / community forums) and confirm they'd pay for audit-ready read confirmations. **Approved (owner decision, Jul 2026)** — run in parallel with M0–M1; kill/pivot checkpoint at M1.
4. **Forge quickstart** — set up dev account + `forge create` a macro to de-risk the platform.
5. **Decide name + build Phase 0–1** as a spike.

## 10. Risks & honest unknowns

- **Small category ceiling** — validate demand is real (low installs may reflect weak incumbent marketing, or genuinely niche demand). Step 3 above de-risks this.
- **MiddleCore's "Read & Confirm"** is a recent Forge entrant doing the modern feature set — a live competitor, though tiny (17 installs). Watch it.
- **Atlassian could ship this natively** — always a platform risk; the compliance/export depth is the defensible layer.
- **Pricing unknown** until §9.1 done.
