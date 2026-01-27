/*
  Warnings:

  - You are about to drop the `EnvironmentSetting` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `createdAt` on the `Claim` table. All the data in the column will be lost.
  - You are about to drop the column `projectId` on the `Claim` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Claim` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `Tax` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Tax` table. All the data in the column will be lost.
  - Made the column `amountHT` on table `Claim` required. This step will fail if there are existing NULL values in that column.
  - Made the column `amountTTC` on table `Claim` required. This step will fail if there are existing NULL values in that column.
  - Made the column `taxRate` on table `Claim` required. This step will fail if there are existing NULL values in that column.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "EnvironmentSetting";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contractHT" REAL,
    "contractTTC" REAL,
    "defaultProvMs" TEXT,
    "defaultProvDcr" TEXT,
    "defaultProvReserve" TEXT
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Claim" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "step" TEXT,
    "projectCode" TEXT,
    "invoiceDate" DATETIME,
    "description" TEXT,
    "province" TEXT,
    "taxRate" REAL NOT NULL,
    "amountHT" REAL NOT NULL,
    "amountTTC" REAL NOT NULL,
    "invoiceNumber" TEXT,
    "status" TEXT,
    "extraC228" REAL,
    "extraC229" REAL,
    "extraC230" REAL,
    "extraC231" REAL,
    "extraNLT5" REAL,
    "extraNLT6" REAL,
    CONSTRAINT "Claim_projectCode_fkey" FOREIGN KEY ("projectCode") REFERENCES "Project" ("code") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Claim" ("amountHT", "amountTTC", "description", "extraC228", "extraC229", "extraC230", "extraC231", "extraNLT5", "extraNLT6", "id", "invoiceDate", "invoiceNumber", "province", "status", "step", "taxRate", "type") SELECT "amountHT", "amountTTC", "description", "extraC228", "extraC229", "extraC230", "extraC231", "extraNLT5", "extraNLT6", "id", "invoiceDate", "invoiceNumber", "province", "status", "step", "taxRate", "type" FROM "Claim";
DROP TABLE "Claim";
ALTER TABLE "new_Claim" RENAME TO "Claim";
CREATE TABLE "new_Project" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL
);
INSERT INTO "new_Project" ("code", "id", "label") SELECT "code", "id", "label" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");
CREATE TABLE "new_Tax" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "province" TEXT NOT NULL,
    "rate" REAL NOT NULL
);
INSERT INTO "new_Tax" ("id", "province", "rate") SELECT "id", "province", "rate" FROM "Tax";
DROP TABLE "Tax";
ALTER TABLE "new_Tax" RENAME TO "Tax";
CREATE UNIQUE INDEX "Tax_province_key" ON "Tax"("province");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
