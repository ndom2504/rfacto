-- CreateTable
CREATE TABLE "ClaimFile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "claimId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClaimFile_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Claim" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "step" TEXT,
    "invoiceDate" DATETIME,
    "description" TEXT,
    "province" TEXT,
    "taxRate" REAL NOT NULL DEFAULT 0,
    "amountHT" REAL NOT NULL DEFAULT 0,
    "amountTTC" REAL NOT NULL DEFAULT 0,
    "invoiceNumber" TEXT,
    "status" TEXT,
    "extraC228" REAL,
    "extraC229" REAL,
    "extraC230" REAL,
    "extraC231" REAL,
    "extraNLT5" REAL,
    "extraNLT6" REAL,
    "projectId" INTEGER,
    CONSTRAINT "Claim_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Claim" ("amountHT", "amountTTC", "description", "extraC228", "extraC229", "extraC230", "extraC231", "extraNLT5", "extraNLT6", "id", "invoiceDate", "invoiceNumber", "projectId", "province", "status", "step", "taxRate", "type") SELECT coalesce("amountHT", 0) AS "amountHT", coalesce("amountTTC", 0) AS "amountTTC", "description", "extraC228", "extraC229", "extraC230", "extraC231", "extraNLT5", "extraNLT6", "id", "invoiceDate", "invoiceNumber", "projectId", "province", "status", "step", coalesce("taxRate", 0) AS "taxRate", "type" FROM "Claim";
DROP TABLE "Claim";
ALTER TABLE "new_Claim" RENAME TO "Claim";
CREATE TABLE "new_Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contractHT" REAL NOT NULL DEFAULT 0,
    "contractTTC" REAL NOT NULL DEFAULT 0,
    "defaultProvMs" TEXT,
    "defaultProvDcr" TEXT,
    "defaultProvReserve" TEXT
);
INSERT INTO "new_Settings" ("contractHT", "contractTTC", "defaultProvDcr", "defaultProvMs", "defaultProvReserve", "id") SELECT coalesce("contractHT", 0) AS "contractHT", coalesce("contractTTC", 0) AS "contractTTC", "defaultProvDcr", "defaultProvMs", "defaultProvReserve", "id" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
CREATE TABLE "new_TaxRate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "province" TEXT NOT NULL,
    "rate" REAL NOT NULL DEFAULT 0
);
INSERT INTO "new_TaxRate" ("id", "province", "rate") SELECT "id", "province", "rate" FROM "TaxRate";
DROP TABLE "TaxRate";
ALTER TABLE "new_TaxRate" RENAME TO "TaxRate";
CREATE UNIQUE INDEX "TaxRate_province_key" ON "TaxRate"("province");
CREATE TABLE "new_TeamMember" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "active" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_TeamMember" ("active", "email", "id", "name", "role") SELECT "active", "email", "id", "name", coalesce("role", 'user') AS "role" FROM "TeamMember";
DROP TABLE "TeamMember";
ALTER TABLE "new_TeamMember" RENAME TO "TeamMember";
CREATE UNIQUE INDEX "TeamMember_email_key" ON "TeamMember"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
