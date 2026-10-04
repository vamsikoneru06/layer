# Security incident response

What to do if VASH's data or systems may have been exposed (a leaked key, an unexpected login to a provider, data
visible to the wrong account, a vulnerability report that checks out). Written for the operator; keep it short and
follow it in order. Not legal advice: check the current text of the laws cited, and involve a lawyer for real incidents.

## Deadlines that matter

| To | When | How |
|---|---|---|
| **CERT-In** (Indian Computer Emergency Response Team) | Within **6 hours** of noticing a reportable cyber incident (CERT-In Directions, 28 April 2022, under IT Act s. 70B) | Form and email on cert-in.org.in (incident@cert-in.org.in) |
| **Affected users** | Without delay, in plain language (DPDP Act 2023 s. 8(6) and the DPDP Rules) | Email from the contact address |
| **Data Protection Board of India** | Without delay, then a detailed report (the DPDP Rules set 72 hours; confirm once those obligations are in force) | As the Board specifies |
| **EU/UK users' authorities** (only if EU/UK users are affected and the breach is a risk to them) | 72 hours (GDPR art. 33) | The relevant supervisory authority |

## Steps

1. **Write down the time** you noticed it. Every deadline counts from then. Keep notes of everything below.
2. **Contain.** Rotate whatever may be exposed, starting with the most powerful:
   - `BETTER_AUTH_SECRET` (signs every user out), the database password (Neon), `STORAGE_*` keys (Supabase),
     `GMAIL_APP_PASSWORD` (revoke at myaccount.google.com/apppasswords), `GOOGLE_CLIENT_SECRET`, `CRON_SECRET`.
   - Update them in Vercel's environment settings and redeploy. Never paste them into chats, issues or commits.
   - If a code path leaks data, disable it (revert the deploy in Vercel) before fixing it.
3. **Assess.** Which data, how many accounts, since when, and whether it was actually accessed. Provider logs:
   Vercel (runtime logs), Neon (query and connection history), Supabase (storage logs), Google account security page.
4. **Report** to CERT-In within 6 hours if it's a reportable incident (for example unauthorised access to systems or
   data, a data breach, or a compromised account or credential). When unsure, report.
5. **Tell the people affected**: what happened, what data, what you've done, what they should do (for example, watch for
   phishing emails).
6. **Fix the cause**, add a test that proves it's fixed, and deploy.
7. **Record** the incident, the reports sent and their times. Keep this record.

## Before anything happens

- Keep secrets only in `apps/web/.env.local` and Vercel's environment settings. CI runs gitleaks on every push.
- Use a dedicated contact address (not a personal inbox) for `CONTACT_EMAIL`; it receives vulnerability reports
  through `/.well-known/security.txt`.
- CERT-In also expects system logs to be kept for 180 days, within India, with clocks synchronised to a trusted time
  source. Vercel's free plan keeps logs only briefly; see `docs/legal/compliance-review.md` for options.
