-- CreateTable
CREATE TABLE "user_businesses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'EDITOR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_businesses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_businesses_user_id_business_id_key" ON "user_businesses"("user_id", "business_id");

-- AddForeignKey
ALTER TABLE "user_businesses" ADD CONSTRAINT "user_businesses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_businesses" ADD CONSTRAINT "user_businesses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
