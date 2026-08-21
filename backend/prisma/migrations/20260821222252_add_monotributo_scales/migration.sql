-- CreateTable
CREATE TABLE "monotributo_scales" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "annualGrossLimit" DECIMAL(18,2) NOT NULL,
    "monthlyFeeServices" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monotributo_scales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monotributo_scales_validFrom_idx" ON "monotributo_scales"("validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "monotributo_scales_category_validFrom_key" ON "monotributo_scales"("category", "validFrom");
