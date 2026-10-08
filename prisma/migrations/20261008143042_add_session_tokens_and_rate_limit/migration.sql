-- DropIndex
DROP INDEX "Signal_toId_idx";

-- AlterTable
ALTER TABLE "Presence" ADD COLUMN "token" TEXT;

-- AlterTable
ALTER TABLE "Signal" ADD COLUMN "deliveredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "RateLimit_windowStart_idx" ON "RateLimit"("windowStart");

-- CreateIndex
CREATE INDEX "Signal_toId_deliveredAt_idx" ON "Signal"("toId", "deliveredAt");

-- CreateIndex
CREATE INDEX "Signal_fromId_toId_idx" ON "Signal"("fromId", "toId");
