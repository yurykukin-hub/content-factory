-- CreateTable
CREATE TABLE "ideas" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ideas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ideas_user_id_idx" ON "ideas"("user_id");

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
