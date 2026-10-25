# School corner badges, Health navigation and school session renewal

The three additional new-item filter buttons were removed. New source entries and grade subject cards show a small rectangular `NOWE` badge at the upper right. Opening an entry persists the current user's read marker; synchronizing or reloading does not make it unread again. The initial baseline excludes existing history.

Health navigation uses the existing icon system, a selected-state card and a responsive two-row phone layout. Button names and pressed-state accessibility remain intact.

Production diagnostics found that both existing school synchronization functions still used an October 7 deployment: successful synchronization timestamps advanced while `sessionConfirmedAt` and the retention deadline remained fixed. The isolated `functions/edu-only.mjs` release updates only those two existing jobs to the current canonical server implementation. It reuses the existing Secret Manager reference without reading or rotating its value. No password persistence or fake "never log out" switch is introduced.

After a fresh authorized provider read and a successful import, the encrypted session retention rolls forward by at most 24 hours. The provider's own deadline remains authoritative; expired, disconnected, revoked or failed sessions are never revived. A provider logout still requires reconnection. Daytime ten-minute and off-hours hourly schedules remain unchanged.

The scoped Firestore file adds only the two private `schoolState` and `schoolSeen` subcollection rules to the exact previous production Finance rules. All existing rules remain byte-identical. No other collection, Storage rule, existing school record, credential, grant or profile is migrated.

Validation includes provider/scheduler/scoped-session tests, real emulator retention integration, exact-release private marker rules, browser read-marker persistence and corner positioning, responsive Health navigation and grade UI regression. See the production receipt after release for final results.

## Production receipt — 2026-10-25

- Production application source: `586700d537d1a4cdfe4e833a0124cf9c05614b90`, Vercel deployment `dpl_3Tid5UrH2MvMe9L5HBJatovDXTKj`, READY and assigned to `nasza-rodzina-web.vercel.app`.
- Both school synchronization functions verified ACTIVE after their update on October 25; their Scheduler jobs are ENABLED with the original Warsaw schedules and existing encryption-secret reference. No secret value was read or changed.
- Active Firestore rules verified byte-for-byte against this directory's release file.
- Passed: 97 server/provider/scheduler tests, 34 grade/newness projection tests, six real emulator integration tests, one exact-release marker-rules test, 14 distinct Chromium UI cases (two badge/Health cases and 12 grade cases). Two pre-existing SP4 assertions for Paweł were corrected to use his current Okruszek region and successfully rerun.
- Production build and Functions canonical source check passed. Existing bundle-size and Firebase SDK upgrade warnings remain outside this minimal change.
- No password is stored, no expired provider session is revived, and no new permanent-login guarantee is claimed. Actual provider revocation still requires reconnecting. Automatic renewal depends on a successful authorized synchronization.
