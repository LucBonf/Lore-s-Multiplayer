# Git Auto-Commit & Push Rule

Dopo ogni modifica o implementazione richiesta dall'utente, esegui sempre automaticamente commit e push sul branch principale senza attendere una richiesta esplicita.

Utilizza PowerShell syntax (es. separatore `;` invece di `&&`):
```powershell
git add <file-modificati>; git commit -m "<messaggio descrittivo>"; git push
```
