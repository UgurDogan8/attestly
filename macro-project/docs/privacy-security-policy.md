# Privacy & Security Policy — Attestly (Confluence Read Confirmation)

Published at: https://ugurdogan8.github.io/attestly-legal/

Last updated: July 2, 2026

## 1. Overview

Attestly is an Atlassian Forge app for Confluence Cloud that lets teams confirm employees
have read and understood important pages (policies, SOPs, security guidelines) and produces
an audit trail for compliance purposes (e.g. ISO 27001, SOC 2, HIPAA readiness).

This app runs entirely on Atlassian's Forge platform. It does not operate its own servers,
does not send data to any third-party service, and does not use any external database. All
data the app creates stays inside your Atlassian cloud site's Forge storage, hosted by
Atlassian in the same data residency region as your Confluence site.

## 2. Data We Collect and Why

| Data | Collected when | Purpose |
|---|---|---|
| Confluence account ID of the acknowledging user | A user clicks "I have read and understood this" on a page | Identify who acknowledged a page, for the audit trail |
| Confluence page ID and page version number | Same as above | Detect when a page changes so a stale acknowledgement can be invalidated and re-requested |
| Timestamp of acknowledgement | Same as above | Audit trail — proves *when* a page was read |
| Confluence account IDs of assigned readers | An admin assigns readers to a page or campaign | Track who is expected to read a page and compute completion percentage |
| Due dates you set | An admin sets a due date for an assignment/campaign | Trigger reminder comments before/after the deadline |
| Campaign names | An admin creates a campaign | Group multiple page assignments under one label for reporting |

We do **not** collect: page content/body text, email addresses, IP addresses beyond what
Atlassian's platform itself logs for security purposes, or any data from outside the
Confluence site the app is installed on.

## 3. How the App Uses Your Data

- **Acknowledgement records** are used to render the "read and confirmed" status on the page
  byline and in the admin panel, and to generate the CSV audit export.
- **Reminder comments**: the app posts a Confluence comment that @mentions users who have a
  pending acknowledgement, which causes Confluence's own native email notification system to
  notify them. The app does not send email itself and does not use any external email/SMS
  provider.
- **Re-acknowledgement notifications**: when a tracked page is edited, the app automatically
  comments and @mentions everyone whose prior acknowledgement is now out of date.

## 4. Where Data Is Stored

All application data (acknowledgement records, reader assignments, campaigns) is stored using
Forge's built-in Key-Value Storage, which is provisioned and encrypted by Atlassian as part of
the Forge platform, physically located in the same region as your Atlassian cloud site's data
residency setting. We (the app developer) have no separate database and no direct access to
this storage outside of the app's own backend code running inside Atlassian's Forge runtime.

## 5. Data Sharing

We do not sell, rent, or share your data with any third party. The app makes no network calls
to any service other than Atlassian's own Confluence REST API (to read page details and post
comments), which runs entirely within Atlassian's infrastructure under the permissions listed
below.

## 6. Permissions (Scopes) Requested and Why

| Scope | Why the app needs it |
|---|---|
| `read:page:confluence` | Read a page's title and current version to detect edits and validate page IDs |
| `storage:app` | Store and retrieve acknowledgement, assignment, and campaign records |
| `write:comment:confluence` | Post reminder and re-acknowledgement comments that @mention pending readers |
| `read:confluence-content.summary` | Receive the page-updated event that triggers re-acknowledgement notifications |

The app requests the minimum set of scopes needed for the features above; it does not request
access to Jira, admin/user-management APIs, or any data outside individual Confluence pages.

## 7. Audit Export Security

The CSV audit export is served through a Forge web trigger (a unique, unguessable URL) that
additionally requires a secret token generated and validated by the app's backend — the
export link only works when requested from inside the admin panel by a user with access to
it. The token is never exposed in application code or logs; it is stored as an encrypted Forge
environment variable.

## 8. Data Retention and Deletion

Data is retained for as long as the app remains installed on your site. If you uninstall the
app, Forge storage associated with the installation is deleted by Atlassian according to
Forge's standard data lifecycle policy. If you need data deleted sooner (e.g. for a specific
user under GDPR/right-to-erasure), contact us at ugur.do808@gmail.com and we will remove the
relevant records via the app's storage APIs.

## 9. Children's Data

This app is a workplace compliance tool intended for use by employees within an organization's
Confluence site. It is not directed at children and we do not knowingly collect data from
children.

## 10. Changes to This Policy

We may update this policy as the app evolves. Material changes will be reflected here with an
updated "Last updated" date.

## 11. Contact

Questions about this policy or your data: ugur.do808@gmail.com
