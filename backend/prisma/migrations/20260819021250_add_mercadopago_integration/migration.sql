-- AlterTable
ALTER TABLE "integrations" ADD COLUMN     "externalAccountId" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastWebhookAt" TIMESTAMP(3),
ADD COLUMN     "tokenExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "movements" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalProvider" TEXT,
ADD COLUMN     "externalStatus" TEXT,
ADD COLUMN     "externalUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "externalProvider" TEXT;

-- CreateTable
CREATE TABLE "integration_oauth_states" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "mobileRedirectUri" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "resourceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'received',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_oauth_states_state_key" ON "integration_oauth_states"("state");

-- CreateIndex
CREATE INDEX "integration_oauth_states_userId_idx" ON "integration_oauth_states"("userId");

-- CreateIndex
CREATE INDEX "integration_webhook_events_provider_status_idx" ON "integration_webhook_events"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_webhook_events_provider_notificationId_key" ON "integration_webhook_events"("provider", "notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_provider_externalAccountId_key" ON "integrations"("provider", "externalAccountId");

-- CreateIndex
CREATE INDEX "movements_userId_needsReview_idx" ON "movements"("userId", "needsReview");

-- CreateIndex
CREATE UNIQUE INDEX "movements_userId_externalProvider_externalId_key" ON "movements"("userId", "externalProvider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_externalProvider_currency_key" ON "wallets"("userId", "externalProvider", "currency");

-- AddForeignKey
ALTER TABLE "integration_oauth_states" ADD CONSTRAINT "integration_oauth_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
