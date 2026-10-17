# Website Phrase Guide active-staff roster sync

The Website Admin has a shared admin login but needs stable IDs/names to attribute individual staff feedback comments. The work-PC Student Admin stays private: the existing Node backend sends active staff IDs/names outbound, without exposing any new inbound API or student data.

## Setup

1. The website receiver must be deployed and configured first, after its separate review (greensquareUpdated PR #386). The receiver endpoint is https://www.greensquare.jp/admin/api/guide-staff-sync.php.
2. On the private work-PC server, configure these environment variables in the existing server .env:
   GS_GUIDE_STAFF_SYNC_URL=https://www.greensquare.jp/admin/api/guide-staff-sync.php
   GS_GUIDE_STAFF_SYNC_SECRET=USE_THE_SAME_RANDOM_SHARED_SECRET_AS_WEBSITE_CONFIG
3. Restart the Node backend after the authorised deployment. With both values set it performs one sync after the server starts and again every 10 minutes via the existing cron scheduler. Without both values, nothing runs. Failed outbound requests are logged but do not stop Student Admin.
4. On the website, open Switch Staff and verify the roster. Check additions and deactivations within 10 minutes; downtime uses the last successfully synchronised roster.

Only SELECT id/name for active staff and one HTTPS POST are involved. Passwords, student information and local DB access are not transmitted. Do not merge/deploy the sender before the website receiver and its server-owned shared secret are provisioned. No production deployment is authorised by this documentation.

Test with node --test server/lib/__tests__/guideStaffRosterPush.test.js.
