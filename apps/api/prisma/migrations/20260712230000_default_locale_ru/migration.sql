-- Default admin locale to Russian for new installs.
ALTER TABLE "admin_users" ALTER COLUMN "locale" SET DEFAULT 'ru';
