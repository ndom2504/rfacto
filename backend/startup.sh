#!/bin/sh
echo "=== DEMARRAGE RFACTO BACKEND ==="

# 1. Generer le client Prisma
echo "Etape 1: Generation client Prisma..."
npx prisma generate
if [ $? -ne 0 ]; then
    echo "ERROR: Generation Prisma a echoue!"
    exit 1
fi

# 2. Correction des migrations (rapide si pas de probleme)
echo "Etape 2: Correction migrations..."
node scripts/fixAzureMigration.js
if [ $? -ne 0 ]; then
    echo "WARN: Fix migration a echoue, continuer quand meme"
fi

# 3. Appliquer les migrations
echo "Etape 3: Migrations Prisma..."
npx prisma migrate deploy
if [ $? -ne 0 ]; then
    echo "WARN: Migrations ont echoue, continuer quand meme"
fi

# 4. Demarrer l'application
echo "Etape 4: Demarrage serveur..."
exec node src/server.cjs
