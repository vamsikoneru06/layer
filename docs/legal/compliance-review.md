# Compliance review: VASH (28 September 2026)

**This is not legal advice.** It's a structured review to prepare for a lawyer. Laws change; confirm the current text
of everything cited, and have a lawyer who practises Indian IT and data-protection law review the Terms and Privacy
Policy before public launch.

## Summary

**Proceed with conditions.** VASH collects little personal data, sells none, runs no ads or tracking, and has strong
technical security. The main legal exposure comes from three things: VASH will host **user content** (published
templates), it processes **personal data** of users in India and possibly the EU, and it's run by **an individual**
(personally liable, with no company in between). Four items block a public launch (see "Before launch").

## Facts this review is based on

- Operator: one individual in India. Free service, no payments, no ads, no analytics.
- Data: email, name, Google profile picture link (Google sign-in), designs, uploaded photos, session IP and browser,
  rate-limit counters (IP or account, up to 2 days), template reports, bug reports (text, page path and browser; account id when signed in; 180 days), an id-only record of account deletions.
- Processors: Vercel (hosting), Neon (Postgres), Supabase (photo storage), Google (OAuth sign-in, Gmail sending), Sentry (scrubbed error reports, up to 90 days), GitHub (encrypted database backups, 7 days).
- User content becomes public when a user publishes a template (API exists; publish UI not built yet).
- Security: strict CSP, owner-scoped API with cross-user tests, rate limits, file-signature checks on uploads,
  short-lived signed URLs, CodeQL, gitleaks, dependency review, `pnpm audit` in CI.

## Applicable laws and policies

| Law or policy | How it applies | Key requirements |
|---|---|---|
| **DPDP Act 2023** and **DPDP Rules 2025** (India) | VASH is a Data Fiduciary for users in India. The Rules were notified in November 2025 with most duties phased in over about 18 months; confirm which are in force. | Clear notice at consent; consent withdrawable; security safeguards; breach notice to the Board and to users; erase data when no longer needed; grievance redressal; **verifiable parental consent for anyone under 18**. |
| **IT Act 2000** and **IT (Intermediary Guidelines) Rules 2021** | Hosting user-published templates makes VASH an intermediary. | Publish terms, privacy policy and a list of prohibited content; remind users at least yearly; **publish a Grievance Officer's name and contact**; acknowledge complaints in 24 h, resolve in 15 days; remove non-consensual intimate imagery within 24 h of complaint; act on court or government orders; keep records of removed content for 180 days. |
| **CERT-In Directions (April 2022)** | Apply to service providers and intermediaries. | Report cyber incidents within **6 hours**; keep logs **180 days within India**; synchronise clocks to a trusted source. |
| **IT Act s. 43A, s. 72A** | Liability for negligent handling of personal data and for disclosure in breach of contract (s. 43A is being replaced by the DPDP Act as it comes into force). | Reasonable security practices; disclose only as the policy says. |
| **Copyright Act 1957** | Users upload photos and publish templates; VASH ships seed templates, fonts and images. | Notice-and-takedown route; don't knowingly host infringing content. The shipped fonts are SIL OFL (licences in `public/fonts/LICENSES.txt`); the sign-in photos are from Unsplash (Unsplash License); the landing illustration is Open Peeps (CC0); the seed templates are original. |
| **GDPR / UK GDPR** | Applies if VASH serves people in the EU or UK (the site is public and free). | Lawful basis; rights (access, erasure, objection, restriction, portability, complaint); 72 h breach notice to the authority; transfer safeguards. |
| **Google API Services User Data Policy** | "Sign in with Google". | Privacy policy must disclose Google data use and the Limited Use statement. Google may require verification of the OAuth consent screen before public launch. |
| **Gmail Terms / Google Workspace** | Sign-in emails are sent from a personal Gmail account through an app password. | Not illegal, but a personal account isn't meant for an app's bulk mail (about 500 a day), and **every recipient sees the operator's personal Gmail address**. |
| **Pexels API Terms** (planned) | Stock photo search. | Show a Pexels credit and photographer credit; don't build a competing stock site. |
| **Consumer Protection Act 2019** | Low risk: the service is free and makes no purchase claims. | Don't make misleading claims (the design rules already forbid fake numbers or reviews). |
| **CCPA / CPRA** | Doesn't apply: below its revenue and volume thresholds. | None now. |

## Requirements and status

| # | Requirement | Status | Action |
|---|---|---|---|
| 1 | Terms, privacy policy and prohibited-content list published (IT Rules 3(1)(a), (b)) | **Met** (updated today) | Lawyer review. |
| 2 | Grievance Officer name and contact published (IT Rules 3(2); DPDP s. 8(10)) | **Not met until set** | Set `GRIEVANCE_OFFICER_NAME` and `CONTACT_EMAIL` in Vercel. The pages show them automatically. |
| 3 | Complaint handling within 24 h / 15 days, NCII within 24 h | **Committed in Terms**; no tooling | Monitor the contact inbox daily; the report button and moderation queue (Plan 3 Part B) will help. |
| 4 | Yearly reminder of the rules to users (IT Rules 3(1)(f)) | **Committed in Terms**; not automated | Send a yearly email (manual is fine at this size). |
| 5 | Consent notice at sign-in (DPDP s. 5, 6) | **Met** (sign-in page now links Terms and Privacy, states 18+) | None. |
| 6 | No processing of children's data without verifiable parental consent (DPDP s. 9) | **Partly met**: Terms and sign-in state 18+ only; no age check | Accept the risk at this size, or add an "I'm 18 or older" checkbox at sign-up. |
| 7 | Data rights: access, correction, erasure, grievance, nomination (DPDP s. 11–14) | **Met** for access, correction, erasure (Settings). Nomination by email. | None. |
| 8 | Breach notification (DPDP s. 8(6); CERT-In; GDPR art. 33) | **Planned**: `docs/legal/incident-response.md` | Keep the plan to hand. |
| 9 | Logs for 180 days within India (CERT-In) | **Not met** | Put Supabase in Mumbai. Neon has no Mumbai region (its closest is Singapore, which `docs/deploy.md` uses, with Vercel functions in `sin1` beside it); decide with a lawyer whether the log rule applies to a one-person free service, and if so, keep request logs in the database for 180 days. |
| 10 | Security safeguards (DPDP s. 8(5); IT Act 43A) | **Met** (see Facts) | Keep CI security checks green; rotate secrets after any suspicion. |
| 11 | Vulnerability reporting route | **Met once `CONTACT_EMAIL` is set** (`/.well-known/security.txt`) | None. |
| 12 | Licence for published templates | **Met** (Terms, "Your content") | Show a short notice in the publish flow when it's built. |
| 13 | Copyright complaint route | **Met** (Terms) | None. |
| 14 | Google Limited Use disclosure | **Met** (Privacy) | Complete Google's consent-screen verification before launch if Google asks. |
| 15 | Personal Gmail used as the sender | **Risk** | Create a separate free Gmail account for VASH (for example `vash.app.help@gmail.com`) and use it for `GMAIL_USER` and `CONTACT_EMAIL`. |

## Risk areas

| Risk | Severity | Mitigation |
|---|---|---|
| Personal liability as an individual operator | High | Keep VASH free and non-commercial until reviewed; consider a sole proprietorship or LLP later; the Terms cap liability at ₹1,000 and include an indemnity (enforceability varies). |
| Illegal or infringing content in published templates | High once publishing ships | Publish flow requires confirming photo ownership (done); add a report button and moderation (Part B); honour the 24 h / 15 day timelines. |
| Minors signing up | Medium | 18+ statement at sign-in and in the Terms; optional age checkbox; delete on discovery. |
| Personal email exposed to all users | Medium | Dedicated VASH Gmail (item 15). |
| No log retention / no incident reporting | Medium | Item 9 and the incident plan. |
| Trademark conflict with the name "VASH" | Unknown | Search the Indian trademark registry (ipindia.gov.in, public search, classes 9 and 42) before launch. |
| Terms not reviewed by a lawyer | Medium | Review before launch; the drafts are written to be easy to review. |

## Before launch (blocking)

1. Set `GRIEVANCE_OFFICER_NAME` and `CONTACT_EMAIL` (a dedicated address) in Vercel.
2. Switch sign-in email to a dedicated VASH Gmail account.
3. Put Supabase in Mumbai (Neon offers only Singapore nearby; see `docs/deploy.md`) and settle the CERT-In log question with a lawyer.
4. Have a lawyer review `/terms` and `/privacy`.

## Further review recommended

- Whether CERT-In's 180-day log rule and the intermediary obligations apply in full to a free, one-person service.
- Enforceability of the ₹1,000 liability cap and the indemnity against consumers.
- Whether to keep VASH open to EU and UK visitors, or restrict it to India until GDPR duties are reviewed.
- Registering the "VASH" name as a trademark.
