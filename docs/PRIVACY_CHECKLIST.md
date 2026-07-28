# TeamZeit privacy readiness checklist

This checklist supports product readiness; it is not legal advice. The deploying
organisation must approve the final policy with its privacy and employment-law
owners before entering real employee data.

## Decisions to record

- controller, processor, and subprocessors;
- lawful purpose for each employee data category;
- retention period for attendance, audit, invitation, and authentication data;
- deletion/anonymisation procedure after employment ends;
- employee access, correction, and data-export process;
- works-council or employee-representation requirements;
- incident and data-breach notification contacts;
- countries in which hosting, email, monitoring, and support data are processed.

## Technical verification

- production and staging use separate projects and credentials;
- least-privilege access is enabled for Supabase, Render, SMTP, and monitoring;
- MFA is required for production administrators;
- RLS and cross-tenant suites pass against every release candidate;
- service-role credentials exist only in server-side secret storage;
- monitoring does not capture request bodies, tokens, or employee identifiers;
- backups have defined retention and access controls;
- restore and deletion procedures are tested and evidenced;
- exported CSV files are handled as personal data and are not retained by TeamZeit.

## Go-live approval

Record the approver, approval date, policy/document versions, last restore test,
last security test run, and the next review date. Any unchecked item blocks the
use of real employee data.
