-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "metrika_counter_id" TEXT,
ADD COLUMN     "metrika_goal_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
