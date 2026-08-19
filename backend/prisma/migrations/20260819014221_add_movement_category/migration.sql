-- AlterTable
ALTER TABLE "movements" ADD COLUMN     "categoryAccountId" TEXT;

-- CreateIndex
CREATE INDEX "movements_categoryAccountId_idx" ON "movements"("categoryAccountId");

-- AddForeignKey
ALTER TABLE "movements" ADD CONSTRAINT "movements_categoryAccountId_fkey" FOREIGN KEY ("categoryAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "movements" m SET "categoryAccountId" = le."accountId"
FROM "ledger_entries" le
JOIN "accounts" a ON a.id = le."accountId"
WHERE le."movementId" = m.id
  AND ((m.type = 'expense' AND a.kind = 'EXPENSE') OR (m.type = 'income' AND a.kind = 'INCOME'));
