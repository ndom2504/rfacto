# Correction de la Migration Échouée sur Azure

## Problème

L'application déployée sur Azure App Service rencontre une erreur de migration Prisma :
- **Erreur P3018** : La migration `20251219103000_add_processing_defaults` a échoué avec "duplicate column name: contractNumber"
- **Erreur P3009** : Les migrations suivantes ne peuvent pas être appliquées car une migration est en échec
- **Erreur P2022** : L'application démarre mais génère des erreurs car les colonnes attendues n'existent pas dans la base de données

## Cause Racine

1. La table `Settings` n'a jamais eu la colonne `contractNumber` dans les migrations officielles
2. Cette colonne a été ajoutée manuellement ou via une modification du schéma Prisma
3. La migration a tenté d'ajouter une colonne déjà existante, causant un échec
4. La migration est marquée comme "failed" dans la table `_prisma_migrations`
5. Prisma refuse d'appliquer les migrations suivantes

## Solution Implémentée

### 1. Suppression des Migrations Problématiques

Les deux migrations problématiques ont été supprimées localement :
- `20251219103000_add_processing_defaults`
- `20251219111500_add_payment_claim_rows_json`

### 2. Création d'une Migration Consolidée

Une nouvelle migration `20260126143000_add_settings_columns` a été créée qui ajoute toutes les colonnes manquantes :
- `contractNumber`
- `processingTaxProv1`
- `processingTaxProv2`
- `processingTaxProv3`
- `paymentClaimRowsJson`

### 3. Script de Correction Automatique

Un script `fixAzureMigration.js` a été ajouté pour :
- Détecter les migrations échouées dans la base de données Azure
- Supprimer les entrées de migration problématiques de `_prisma_migrations`
- Ajouter manuellement les colonnes manquantes (en ignorant les doublons)
- Permettre à Prisma d'appliquer ensuite la nouvelle migration consolidée

### 4. Modification du Script de Démarrage

Le script `npm start` a été modifié pour exécuter automatiquement la correction :

```json
"start": "node scripts/fixAzureMigration.js && npx prisma generate && npx prisma migrate deploy && node src/server.cjs"
```

## Déploiement sur Azure

### Étapes à Suivre

1. **Commitez et poussez les changements** :
   ```bash
   git add .
   git commit -m "fix: Correction migration échouée Azure"
   git push
   ```

2. **Déployez sur Azure** :
   - Le déploiement se fera automatiquement via GitHub Actions ou votre pipeline CI/CD
   - Ou utilisez : `az webapp deployment source sync --name <app-name> --resource-group <resource-group>`

3. **Vérifiez les logs** :
   ```bash
   az webapp log tail --name <app-name> --resource-group <resource-group>
   ```

### Ce qui va se Passer

1. Azure redémarre l'application
2. Le script `fixAzureMigration.js` s'exécute :
   - Détecte les migrations échouées
   - Supprime les entrées problématiques
   - Ajoute les colonnes manquantes
3. `npx prisma generate` génère le client Prisma
4. `npx prisma migrate deploy` applique la nouvelle migration consolidée
5. Le serveur démarre normalement

## Vérification

Une fois déployé, vérifiez que :
- ✅ Les logs ne montrent plus d'erreur P3009 ou P3018
- ✅ L'application démarre correctement
- ✅ Les appels à `/api/settings` fonctionnent sans erreur P2022
- ✅ La migration `20260126143000_add_settings_columns` est marquée comme appliquée

## Notes Importantes

- Le script `fixAzureMigration.js` est idempotent : il peut être exécuté plusieurs fois sans problème
- Il se termine rapidement si aucune correction n'est nécessaire
- Il a un timeout de 10 secondes pour ne pas bloquer le démarrage
- Il ne bloque pas le démarrage même en cas d'erreur

## Déploiement Local (Test)

Pour tester localement :

```bash
cd backend
npm install
node scripts/fixAzureMigration.js
npm run dev
```

## Rollback (Si Nécessaire)

Si vous devez revenir en arrière :

1. Restaurez les anciennes migrations depuis Git
2. Supprimez la migration consolidée
3. Utilisez `npx prisma migrate resolve --rolled-back` pour marquer les migrations comme annulées
