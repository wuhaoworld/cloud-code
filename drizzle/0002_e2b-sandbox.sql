-- Vercel sandbox names are not valid E2B sandbox IDs. Clear provider-specific
-- connection data before the application begins creating E2B instances.
UPDATE `workspace`
SET `sandbox_id` = NULL,
    `sandbox_token` = NULL,
    `sandbox_url` = NULL,
    `sandbox_status` = 'idle';

ALTER TABLE `workspace` DROP COLUMN `sandbox_snapshot_id`;
