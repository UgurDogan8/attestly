# Competitor pricing research — Attestly

Researched 2026-07-03 via public web search + direct fetches (no Marketplace login used).
Answers the "Acil sonraki adımlar" item from the product brief: "QC + Comala + Read & Confirm
fiyatlandırma katmanlarını araştır."

## What's publicly visible vs. not

Atlassian Marketplace's own pricing tab is rendered client-side (JavaScript) and returned
nothing when fetched directly or via the (undocumented, seemingly retired) Marketplace REST
API — this matches the product brief's original note that pricing "requires a logged-in
view." Vendor product pages for QC Analytics and MiddleCore also don't publish numbers; QC
Analytics pushes visitors to a Calendly call or direct contact instead.

**Not found:** QC Read and Understood exact pricing, MiddleCore Read & Confirm exact pricing.

**Found:** Appfire (Comala's parent company) publishes annual "pricing update" pages with full
tier tables for its Comala product line — these are real, current (effective July 1, 2026)
numbers.

## Comala Read Confirmations (exact category match — found after initial research, see note below)

**Important correction to the product brief:** while researching competitor #4 ("Read
Confirmations for Confluence", app id 1221972), web search surfaced a product Appfire/Comala
launched that the original brief's competitive analysis missed entirely: **Comala Read
Confirmations** (Atlassian Marketplace app id 1222969), **284 installs** — almost matching QC
Read and Understood's 323. This directly contradicts the brief's assumption that "Appfire/
Comala isn't actively defending this category." See `## Riskler` in `CLAUDE.md` for the full
competitive-risk update; this section covers its pricing, which is the best available anchor
since it's the exact same category as Attestly (not the broader Document Approval/Management
products below).

Cloud, annual, USD, effective July 1, 2026:

| Users | Price/year | Effective $/user/year |
|---|---|---|
| 1–10 | Free | – |
| 25 | $235 | $9.40 |
| 50 | $470 | $9.40 |
| 100 | $940 | $9.40 |

Flat **~$9.40/user/year (~$0.78/user/month)** above the free tier — this is the number to
undercut, not the $6.60 figure below (that's for a different, broader Comala product).

## Comala Document Approval (broader product, kept for context/triangulation)

This is Comala's lighter "approve/sign off on a document" product — closer to Attestly's
scope than their full Document Management workflow suite.

Cloud, annual, USD:

| Users | Price/year | Effective $/user/year |
|---|---|---|
| 1–10 | Free | – |
| 25 | $165 | $6.60 |
| 50 | $330 | $6.60 |
| 500 | $2,430 | $4.86 |
| 1,000 | $4,380 | $4.38 |

Flat marginal rate of **~$6.60/user/year (~$0.55/user/month)** above the free tier at
small-to-mid team sizes, with volume discounts kicking in at scale.

## Comala Document Management (full workflow suite, for contrast)

Cloud, annual, USD:

| Users | Price/year | Effective $/user/year |
|---|---|---|
| 1–10 | Free | – |
| 25 | $593 | $23.72 |
| 50 | $1,185 | $23.70 |
| 100 | $2,370 | $23.70 |

About **3.6x more expensive per user** than Document Approval — makes sense, it's a much
bigger product (full approval workflows, versioning, publishing states). Confirms Document
Approval, not Document Management, is the right price anchor for Attestly.

## Other competitors found during this research (not pricing-related, see `CLAUDE.md` Riskler)

- **avono Read Confirmations for Confluence** (avono AG, app id 1210734) — 84 installs. The
  fetched listing only showed Confluence Server/Data Center version ranges; Cloud
  availability wasn't confirmed.
- **Read Confirmations for Confluence** (Realigned Technologies, app id 1221972) — existence
  confirmed (this was the brief's "verify competitor #4" item), install count not obtainable
  (Marketplace page didn't render via direct fetch).

## What this means for Attestly's pricing

The brief's planned strategy — "≤10 kullanıcı ücretsiz, sonrası Appfire/Comala katmanının
altında" — is now backed by a real number to undercut, and it should be **Comala Read
Confirmations' $9.40/user/year**, not the broader Document Approval product's $6.60 (that one
is a different, bigger product — Read Confirmations is the true apples-to-apples comparison).

**Suggested range to consider: $4–$6/user/year (~$0.33–$0.50/user/month) above the free
10-user tier** — clearly and defensibly cheaper than Comala's $9.40 anchor while leaving
margin after Atlassian's ~15%+ revenue share. This is a recommendation for you to confirm,
not a final decision. I did not update the Marketplace listing FAQ with a hard number; it
still says "see the pricing tab" until you decide.

## Sources

- [Comala Read Confirmations pricing update](https://appfire.com/pricing-updates/comala-read-confirmations) — the primary anchor, exact category match
- [Comala Read Confirmations — Atlassian Marketplace listing](https://marketplace.atlassian.com/apps/1222969/comala-read-confirmations) (284 installs)
- [Comala Document Management pricing update](https://appfire.com/pricing-updates/comala-document-management) (broader product, context only)
- [Comala Document Approval pricing update](https://appfire.com/pricing-updates/comala-document-approval) (broader product, context only)
- [QC Read and Understood — Atlassian Marketplace listing](https://marketplace.atlassian.com/apps/1219398/qc-read-and-understood-for-confluence) (323 installs, no public pricing)
- [Read & Confirm for Confluence (MiddleCore) — Atlassian Marketplace listing](https://marketplace.atlassian.com/apps/1138072457/read-confirm-for-confluence) (16 installs, no public pricing)
- [avono Read Confirmations for Confluence — Atlassian Marketplace listing](https://marketplace.atlassian.com/apps/1210734/avono-read-confirmations-for-confluence) (84 installs, Server/Data Center version shown)
- [Read Confirmations for Confluence — Atlassian Marketplace listing](https://marketplace.atlassian.com/apps/1221972/read-confirmations-for-confluence) (Realigned Technologies; exists, install count unobtainable)
- [QC Analytics product page](https://qc-analytics.com/products/qc-read-understood-for-confluence/) (no public pricing, pushes to sales contact)
