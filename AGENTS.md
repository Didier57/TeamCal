# TeamCal — Consignes agent

## Git / CI
- Après chaque changement validé : lancer `npm run typecheck` et `npm test -w server`, puis commiter et pousser automatiquement sur `origin main` (message au style `feat:`, `fix:`…).
- Après chaque push : nettoyer les runs GitHub Actions pour ne conserver que les 4 derniers (`gh run list`, `gh run delete <id>`).

## Commandes
- `npm run typecheck` (server + client)
- `npm test -w server`
- PowerShell : appeler `& git.exe ...` et `& npm.cmd ...`.
