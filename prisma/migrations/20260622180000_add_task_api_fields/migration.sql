CREATE TYPE "TaskVisibility" AS ENUM ('PRIVATE', 'VENUE');

ALTER TABLE "UserTask"
ADD COLUMN "visibility" "TaskVisibility" NOT NULL DEFAULT 'PRIVATE',
ADD COLUMN "onboardingKey" TEXT;

CREATE INDEX "UserTask_dueDate_idx" ON "UserTask"("dueDate");
CREATE UNIQUE INDEX "UserTask_assigneeUserId_onboardingKey_key"
ON "UserTask"("assigneeUserId", "onboardingKey");

CREATE TABLE "UserTaskSettings" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "weekStartsOn" INTEGER NOT NULL DEFAULT 1,
    "showCompleted" BOOLEAN NOT NULL DEFAULT true,
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserTaskSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserTaskSettings_userId_key" ON "UserTaskSettings"("userId");
ALTER TABLE "UserTaskSettings"
ADD CONSTRAINT "UserTaskSettings_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;