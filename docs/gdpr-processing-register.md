# Attendance Log — GDPR Processing Register

- Scope: Attendance Log processing activities only
- Controller: ASBL Nouveaux Horizons
- GDPR contact: contact@nouveauxhorizons.be
- Version: 1.0
- Record date: 12 September 2026

This is a focused internal record of processing for Attendance Log, not the complete organizational Article 30 register. Contractual terms, configured providers, data-transfer arrangements, processor agreements, recipient governance, and any additional statutory obligations require organizational/legal confirmation.

## Common organizational parameters

- Identifiable participant retention: while participation or an active registration requires it, then a maximum of 12 months after the last meaningful activity once the participant is inactive and has no active membership.
- Historical statistics: attendance facts may remain after irreversible removal of participant identity.
- Anonymization: administrator-triggered, irreversible, and one participant at a time; no automatic or bulk processing exists.
- Technical providers: the actual outbound-email and private backup/storage providers depend on installation configuration. Their identity, role, location, safeguards, and transfer mechanism must be confirmed from the live contracts and configuration.

## 1. Participant/student administration

- **Purpose:** identify and contact participants and administer the training relationship.
- **Data:** first name, last name, e-mail, participant code, active state, public application identifier, creation and meaningful-activity dates.
- **Data subjects:** current and former participants.
- **Legal basis:** Article 6(1)(b) GDPR, insofar as processing is necessary for registration and delivery of the requested training/service.
- **Access/recipients:** authorized administrators and managers; attendance operators receive only the separate operational minimum described below.
- **Retention:** common participant-retention rule; anonymous historical facts may remain after identity is anonymized.
- **Safeguards:** role-based permissions, opaque public URLs, server-side authorization, participant export, rectification, retention preview, manual anonymization, audit trail.
- **External flow:** outbound e-mail provider when an authorized participant communication is sent; configured provider and processing terms require confirmation.

## 2. Registrations and memberships

- **Purpose:** associate participants with the activities or courses for which they are registered and construct authorized operational rosters.
- **Data:** participant reference, activity/course, membership status, membership creation date.
- **Data subjects:** current and former participants.
- **Legal basis:** Article 6(1)(b) GDPR for administration and delivery of the registration.
- **Access/recipients:** authorized administrators and managers; operational roster information is available to authorized attendance users as necessary.
- **Retention:** active while needed for registration; historical membership facts are retained with attendance history and become anonymous when participant identity is anonymized.
- **Safeguards:** separate participant and membership activity states, historical-roster integrity, authorization, Audit Log.
- **External flow:** none by default.

## 3. Attendance tracking

- **Purpose:** record session participation, support session operation, and produce attendance statistics.
- **Data:** participant reference, activity/session, attendance status, change timestamps.
- **Data subjects:** registered participants.
- **Legal basis:** Article 6(1)(f) GDPR; legitimate interest in organizing training, confirming participation, and understanding attendance.
- **Access/recipients:** authorized administrators, managers, and attendance operators; configured summary-email recipients may receive a session summary.
- **Retention:** common participant-retention rule for identity; attendance facts may remain anonymously for historical statistics.
- **Safeguards:** minimized roster identity, closed-session controls, idempotent transactional writes, Audit Log, Reporting pseudonymization, irreversible anonymization.
- **External flow:** outbound e-mail provider only where a configured attendance-summary message is sent.

## 4. Arrival and punctuality tracking

- **Purpose:** calculate punctuality where a session start time is configured and support proportionate operational statistics.
- **Data:** arrival timestamp, session-local start time, tolerance, signed delay, punctuality result.
- **Data subjects:** participants attending applicable sessions.
- **Legal basis:** Article 6(1)(f) GDPR; legitimate interest in session organization and proportionate punctuality statistics.
- **Access/recipients:** authorized operational users and permitted Reporting users; configured session-summary recipients where applicable.
- **Retention:** follows the related attendance fact; identity is subject to the common participant-retention rule.
- **Safeguards:** optional start time, no absence/lateness reason, no behavioral profile, no automated decision or sanction, timezone-safe centralized calculation, View PII and pseudonymized Reporting.
- **External flow:** possible inclusion in configured attendance-summary e-mail; provider details require confirmation.

## 5. Participant QR attendance identification

- **Purpose:** identify the correct participant during an authorized attendance check-in.
- **Data:** random individual QR identifier linked to the participant; the QR payload contains no participant PII.
- **Data subjects:** participants issued a QR code.
- **Legal basis:** Article 6(1)(f) GDPR as a proportionate means of operating attendance tracking. Organizational/legal confirmation required if use or purpose changes.
- **Access/recipients:** authorized participant-management users can issue/send/print it; authorized attendance users can scan it.
- **Retention:** valid while the participant remains operationally usable; rotated and invalidated on irreversible anonymization.
- **Safeguards:** non-guessable purpose-specific token, no PII in payload, online-authoritative writes, RBAC, invalidation on anonymization.
- **External flow:** outbound e-mail provider when the participant's QR is sent by e-mail.

## 6. Reporting and statistics

- **Purpose:** understand attendance and punctuality by activity, session, and participant where permitted.
- **Data:** attendance, arrival/punctuality facts, activity/session data; participant identity only when the viewer has View PII and the report supports identified detail.
- **Data subjects:** current, former, and anonymized historical participants.
- **Legal basis:** Article 6(1)(f) GDPR; legitimate interest in understanding and improving training organization.
- **Access/recipients:** users with Reporting business permission; participant identity is independently controlled by per-user View PII.
- **Retention:** reports are generated from retained operational/history data and are not separately persisted by the application.
- **Safeguards:** data-layer minimization, activity-scoped pseudonyms, HTML/export parity, no-store authenticated responses, attendance operators denied Reporting.
- **External flow:** none by default; downloaded exports leave application control and require organizational handling rules.

## 7. Automated session-summary e-mails

- **Purpose:** inform configured recipients of finalized session attendance and punctuality results after closure.
- **Data:** activity/session information, participant name, attendance status, arrival/punctuality where applicable; optional XLSX summary.
- **Data subjects:** participants in the closed session and configured administrative/external recipients.
- **Legal basis:** Article 6(1)(f) GDPR for efficient training administration. Recipient selection, necessity, and external-address governance require organizational/legal confirmation.
- **Access/recipients:** configured active administrator recipients and validated external addresses, delivered using BCC privacy protections.
- **Retention:** message retention is governed by recipient mailboxes and the configured mail provider, not Attendance Log; organizational limits require confirmation.
- **Safeguards:** post-commit delivery, current-address resolution, deduplication, BCC, no message-body audit logging, explicit recipient configuration.
- **External flow:** configured outbound e-mail provider; processor terms, location, and retention require confirmation.

## 8. Audit and security logging

- **Purpose:** accountability, investigation of meaningful business/security actions, and protection of administrative access and data integrity.
- **Data:** actor snapshot, action, target reference/label, result, concise changes, safe metadata, hashed IP and user-agent fingerprints.
- **Data subjects:** administrator users and, where targeted, participants.
- **Legal basis:** Article 6(1)(f) GDPR for security, accountability, and misuse investigation. Any reliance on a specific legal obligation requires organizational/legal confirmation.
- **Access/recipients:** administrators only.
- **Retention:** indefinite by current V1 application behavior, guaranteeing at least 12 months; a formal organizational retention period remains to be confirmed.
- **Safeguards:** append-only application behavior, structured allowlists, no raw IP/user agent, no credentials/OTP/QR tokens, targeted participant-PII redaction during anonymization.
- **External flow:** application/container logs may be processed by the hosting environment; operational logging arrangements require confirmation.

## 9. Participant GDPR access/export

- **Purpose:** help Nouveaux Horizons identify and provide the personal data held about one participant when assessing a rights request.
- **Data:** participant identity, memberships, attendance/punctuality, and participant-targeted audit history; explicit exclusions apply to secrets, fingerprints, QR tokens, and unrelated records.
- **Data subjects:** the participant concerned; minimal administrator actor information may appear in targeted audit history.
- **Legal basis:** Article 6(1)(c) GDPR where processing is necessary to respond to applicable data-subject rights obligations. Request validation and any exceptions require organizational/legal confirmation.
- **Access/recipients:** administrators; the generated file must be disclosed only through the verified rights-request process.
- **Retention:** generated in memory and not retained by Attendance Log; downloaded copies are governed by organizational handling procedures.
- **Safeguards:** public UUID route, administrator-only authorization, field allowlists, formula-safe XLSX, private/no-store and nosniff headers, audited export action.
- **External flow:** none by the application unless the administrator transmits the downloaded file separately.

## 10. Participant anonymization

- **Purpose:** irreversibly remove participant identity after the retention conditions are met while preserving anonymous historical statistics.
- **Data:** eligibility state, replacement technical identifiers, anonymization timestamp, retained anonymous membership/attendance facts, redacted participant-targeted audit history.
- **Data subjects:** inactive former participants with no active membership who have reached the retention threshold.
- **Legal basis:** storage-limitation and rights-management obligations may support Article 6(1)(c), with legitimate security/data-governance interests under Article 6(1)(f). Exact organizational legal basis requires confirmation.
- **Access/recipients:** administrators only; no external recipient.
- **Retention:** replacement anonymous historical subject and statistical facts may remain; former live identity is irreversibly removed. Old backups expire separately.
- **Safeguards:** centralized eligibility rule, fresh transaction-time evaluation, row locking, explicit confirmation, single atomic transaction, QR rotation, Audit Log redaction, strict audit event, rollback on failure, integration-tested concurrency and erasure sweep.
- **External flow:** no direct flow; pre-anonymization identity may remain temporarily in bounded-retention backups.

## 11. Backup and Restore

- **Purpose:** continuity, recovery from failure, and preservation of application integrity.
- **Data:** logical copy of application database content, including participant and administrator data and encrypted provider-secret ciphertext; active session rows and OTP/rate-limit rows are excluded from backup data.
- **Data subjects:** participants and administrator users represented in the database.
- **Legal basis:** Article 6(1)(f) GDPR for service continuity, security, and recovery. Backup schedule, retention, and destination governance require organizational confirmation.
- **Access/recipients:** authorized administrators and configured private storage provider.
- **Retention:** configured bounded rotation for cloud backups; manual downloads require separate organizational control. Archives are not rewritten after live anonymization and expire under the applicable policy.
- **Safeguards:** custom-format logical dump, controlled archive contents, private objects, provider-side encryption, encrypted provider secrets, recovery key excluded, isolated staging restore, migration validation, safety backup, maintenance mode.
- **External flow:** configured S3/S3-compatible or Azure Blob provider when enabled; processor, region, transfer, and contractual safeguards require confirmation.

## 12. Administrator authentication

- **Purpose:** authenticate authorized users, enforce roles, protect administrative and operational functions, and respond to misuse.
- **Data:** administrator name/e-mail or local username, role, View PII state, account status, session metadata, hashed OTP challenges, break-glass password hash, hashed rate-limit identifiers.
- **Data subjects:** administrators, managers, and attendance operators.
- **Legal basis:** Article 6(1)(f) GDPR for access security and protection of the application. Employment/volunteer governance and any additional legal basis require organizational confirmation.
- **Access/recipients:** authorized account administrators; configured outbound e-mail provider processes OTP delivery for normal accounts.
- **Retention:** account records follow organizational administrator lifecycle; OTP and rate-limit data are short-lived; active sessions are not restored from backups. Precise account/audit retention requires confirmation.
- **Safeguards:** fixed RBAC, database-backed active-user checks on every request, session versioning, short-lived single-use hashed OTP, rate limits, one bcrypt-protected break-glass account, secure cookies, audit events.
- **External flow:** configured outbound e-mail provider for OTP delivery; processor and retention terms require confirmation.

## Register maintenance

Review this record whenever Attendance Log changes its purposes, data categories, roles/access, external providers, report delivery, retention, anonymization, authentication, backup destinations, or automated decision-making. Reconcile it with actual configuration and the organization's wider processing register rather than treating repository documentation as the sole legal record.
