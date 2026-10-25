# Finance, points corrections and shared document copies — 2026-10-25

Finance was read-only because its server write switch was never released. `FINANCE_WRITES_ENABLED` enables only this domain. Preview and mixed emulator guards remain enforced. Disabled profiles are rejected using a fresh transactional member read.

`firestore.rules` extends the previous deployed Health rules with only the finance ACL block. Existing rules are preserved byte-for-byte. Bills are restricted to parents of the same family or individually selected children; clients cannot write bills or audit entries. The separate scheduled `financeReminders` function runs at 09:00 Europe/Warsaw. No manual production maintenance run or data migration is included.

Parents can correct an earned points entry to an integer including zero. A compensating ledger entry updates both available and total earned points in the same transaction, preserves the original award and completion, rejects stale revisions and negative balances, and uses a stable request identifier for retry safety. Production points are left for the user to correct explicitly.

The server-configured shared-copy folder admits only its three explicitly configured active family members. Uploaded copies have those three readers/editors and are pinned automatically. Other members require explicit sharing of each file and receive read access only. This feature does not create medical consent or a verified legal representation grant. No existing medical files or consent records are modified.

Validation: 327 unit tests; 71 server tests covering finance, scoped flags, HTTP authentication, points and health; one exact-release finance rules test; three Chromium finance tests exercising real local Firestore transactions and responsive layouts. Production build and Functions source checks passed. The full browser finance flow uses local demo emulators; production checks are read-only and open forms without saving household records.

Excluded: the 236-document migration, backup expansion, global write enablement, changes to other module rules, and test mutations of real bills, points or medical records. Existing build warning about large bundles remains.

## Production receipt

- Application source: `97e96d49ac190582f90c3ebaa9b75cdedea3091c`.
- Vercel deployment: `dpl_9jLjHRpC4Ht5wL5M6x7N5spi6v4x`, confirmed READY and assigned to `nasza-rodzina-web.vercel.app`.
- Production browser confirmed the enabled finance save button, the parent correction dialog for the existing +5 entry, and the shared-copy shortcut with precisely the requested three names. Every inspected form was cancelled without saving.
- Exact active Firestore rules match this directory; active default Storage rules still match `deploy/health/storage.rules`.
- `financeReminders` confirmed ACTIVE, scheduler ENABLED, `0 9 * * *`, Europe/Warsaw. No manual run requested.
- Additional regression validation: 18 health/task/access rules tests and four Chromium health attachment tests passed. Combined validation: 327 unit, 71 server, 19 rules, seven browser tests.
- No existing medical documents were reassigned. The shared-copy folder is ready for the family to upload its own files. The existing +5 points remain unchanged until the parent explicitly saves a correction.
