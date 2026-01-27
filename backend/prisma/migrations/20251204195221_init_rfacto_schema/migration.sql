/*
  Warnings:

  - You are about to drop the `Tax` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `projectCode` on the `Claim` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Tax_province_key";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "taxProvince" TEXT;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Tax";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "province" TEXT NOT NULL,
    "rate" REAL NOT NULL
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
    "taxRate" REAL,
    "amountHT" REAL,
    "amountTTC" REAL,
    "invoiceNumber" TEXT,
    "status" TEXT,
    "projectId" INTEGER,
    "extraC228" REAL,
    "extraC229" REAL,
    "extraC230" REAL,
    "extraC231" REAL,
    "extraNLT5" REAL,
    "extraNLT6" REAL,
    CONSTRAINT "Claim_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Claim" ("amountHT", "amountTTC", "description", "extraC228", "extraC229", "extraC230", "extraC231", "extraNLT5", "extraNLT6", "id", "invoiceDate", "invoiceNumber", "province", "status", "step", "taxRate", "type") SELECT "amountHT", "amountTTC", "description", "extraC228", "extraC229", "extraC230", "extraC231", "extraNLT5", "extraNLT6", "id", "invoiceDate", "invoiceNumber", "province", "status", "step", "taxRate", "type" FROM "Claim";
DROP TABLE "Claim";
ALTER TABLE "new_Claim" RENAME TO "Claim";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "TaxRate_province_key" ON "TaxRate"("province");
