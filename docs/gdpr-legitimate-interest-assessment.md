# GDPR Legitimate Interest Assessment — Attendance and Punctuality

- Controller: ASBL Nouveaux Horizons
- Contact: contact@nouveauxhorizons.be
- Version: 1.0
- Assessment date: 12 September 2026
- Review owner: ASBL Nouveaux Horizons

This assessment concerns attendance and punctuality processing performed through Attendance Log. It records the current rationale and safeguards; it is not, by itself, proof of GDPR compliance.

## 1. Processing assessed

The processing records whether a participant attended a scheduled training session. When a session has a configured start time, it may also record the participant's arrival time and derive an early, on-time, or late result and a signed delay in minutes.

It does not collect reasons for absence or lateness, unrelated behavioral information, or data for automated disciplinary scoring.

## 2. Legal basis

The assessed basis is Article 6(1)(f) GDPR: the legitimate interests of ASBL Nouveaux Horizons.

This assessment is limited to attendance, arrival-time, punctuality, and related operational statistics. It does not assume that the same basis necessarily applies to every feature or future use of Attendance Log.

## 3. Legitimate interest

Nouveaux Horizons has a real and current interest in:

- organizing training activities and confirming actual participation;
- understanding attendance across sessions;
- ensuring sessions function properly;
- producing proportionate attendance and punctuality statistics;
- improving the practical organization of training activities.

These interests concern the delivery and operation of organized training, not generalized participant monitoring.

## 4. Necessity test

Attendance status is necessary to establish whether a registered participant attended a session. Aggregate attendance statistics cannot be produced reliably without this underlying session fact.

An arrival timestamp is necessary only when a session has a configured start time and punctuality is actually calculated. The application does not require a start time for every session, and sessions without one have no punctuality result.

The current design limits collection:

- no reason for absence is recorded;
- no reason for lateness is recorded;
- no unrelated behavioral observation is recorded;
- duplicate check-ins do not replace the original arrival time;
- punctuality is calculated from the minimum required session and arrival data rather than stored as a separate behavioral flag.

A less identifying aggregate can be used for many analytical views, which is why Reporting supports pseudonymized participant rows when real identity is unnecessary. Identified attendance remains necessary in the operational attendance workflow so staff can record the correct person.

## 5. Balancing test

Participants in an organized training context can reasonably expect registration and attendance to be administered. Recording arrival time may be less universally expected, so it is used only where a session start time is configured and should be transparently explained.

The data categories are limited but still capable of revealing patterns about a person's participation. The main possible impact is unwanted disclosure, excessive interpretation of punctuality, or retention beyond the operational need. The current design reduces that impact through:

- role-based business permissions;
- minimum operational identity in attendance interfaces;
- independent per-user View PII control for Reporting;
- activity-scoped pseudonymization when Reporting does not require identity;
- a 12-month organizational retention policy after last meaningful activity, subject to inactivity and no active membership;
- administrator preview of retention eligibility;
- manual, single-participant irreversible anonymization;
- invalidation of the former QR identifier during anonymization;
- redaction of participant PII from targeted Audit Log history during anonymization;
- audited sensitive operations;
- administrator tools to rectify and export participant data;
- bounded backup retention and rotation support;
- unit and isolated PostgreSQL integration tests for core privacy invariants.

Punctuality information is not used for automated decisions, behavioral profiling, or automatic sanctions. Any future disciplinary or evaluative use would require a new assessment.

## 6. Risks and mitigations

| Risk | Potential impact | Current mitigation |
|---|---|---|
| Identified attendance visible to unnecessary users | Unjustified disclosure of participation patterns | Role restrictions, minimized attendance interfaces, View PII for optional Reporting identity |
| Punctuality over-interpreted | A limited timing fact treated as a behavioral judgment | Neutral calculation, no reasons or scoring, no automated decision or sanction |
| Excessive identifiable retention | Identity remains attached to history longer than necessary | 12-month policy, eligibility preview, active-membership blocker, irreversible anonymization |
| Identity copied into reports or exports | Wider dissemination and loss of control | Data-layer pseudonymization, export parity, administrator-only participant data export, no-store responses |
| Identity retained in Audit Log after anonymization | Former identity remains reconstructable | Transactional targeted redaction with strict anonymization audit event |
| Identity remains in old backups | Temporary recovery copy outlives live anonymization | Bounded backup rotation; archives expire rather than being retroactively rewritten |
| Unauthorized QR reuse after anonymization | Former badge remains operational | QR rotation and rejection of the old identifier |

Residual risk remains, particularly where authorized users export data or where older backups have not yet expired. Nouveaux Horizons must complement technical controls with access governance, staff instructions, processor agreements, and an appropriate backup-retention configuration.

## 7. Conclusion

Under the current processing design, Nouveaux Horizons considers its interest in attendance and proportionate punctuality tracking to remain necessary and balanced against participant rights and freedoms. This conclusion is conditional on the stated purpose, minimization, access controls, retention policy, absence of automated decisions, and continued operation of the safeguards above.

This conclusion must not be treated as a general legal-compliance declaration for Attendance Log or for all organizational processing.

## 8. Review triggers

Review this LIA before or promptly after any meaningful change to:

- the purpose of attendance or punctuality processing;
- the categories or precision of data collected;
- identified or pseudonymized Reporting;
- recipients or external processors;
- identifiable retention or anonymization rules;
- automated decision-making, scoring, profiling, or sanctions;
- the operational use or interpretation of punctuality information.

Also review it periodically under Nouveaux Horizons' governance process and record the new date, version, decision, and owner.
