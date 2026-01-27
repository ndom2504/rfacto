-- Migration vide car les colonnes existent déjà dans la plupart des environnements
-- Cette migration sert à synchroniser l'état des migrations entre les environnements
-- Les colonnes sont ajoutées via le script fixAzureMigration.js si nécessaire
SELECT 1;
