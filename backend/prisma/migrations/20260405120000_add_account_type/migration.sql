-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('GROUP', 'PERSONAL', 'CHANNEL', 'BOT', 'BUSINESS');

-- AlterTable: add account_type column
ALTER TABLE "platform_accounts" ADD COLUMN "account_type" "AccountType" NOT NULL DEFAULT 'GROUP';

-- Drop old unique constraint
ALTER TABLE "platform_accounts" DROP CONSTRAINT IF EXISTS "platform_accounts_business_id_platform_key";

-- Create new unique constraint (allows multiple accounts per platform)
CREATE UNIQUE INDEX "platform_accounts_business_id_platform_account_id_key" ON "platform_accounts"("business_id", "platform", "account_id");
