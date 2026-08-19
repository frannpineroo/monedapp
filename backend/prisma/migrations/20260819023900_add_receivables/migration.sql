-- DropForeignKey
ALTER TABLE "movements" DROP CONSTRAINT "movements_walletId_fkey";

-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN "changeArs" DECIMAL(18,2);

UPDATE "ledger_entries" le
SET "changeArs" = ROUND(le.change * er.value, 2)
FROM "movements" m
JOIN "exchange_rates" er ON er.id = m."exchangeRateId"
WHERE le."movementId" = m.id;

ALTER TABLE "ledger_entries" ALTER COLUMN "changeArs" SET NOT NULL;

-- AlterTable
ALTER TABLE "movements" ADD COLUMN     "dueDate" DATE,
ADD COLUMN     "invoiceId" TEXT,
ALTER COLUMN "walletId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "movements_invoiceId_idx" ON "movements"("invoiceId");

-- AddForeignKey
ALTER TABLE "movements" ADD CONSTRAINT "movements_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movements" ADD CONSTRAINT "movements_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
