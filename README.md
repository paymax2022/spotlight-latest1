# spotlight-latest

## Git Safety Setup

Run once after cloning:

```bash
bash scripts/install-git-hooks.sh
```

This repo is configured to prevent accidental pushes of:

- generated build caches like `.next/` and `.npm-cache/`
- local-only or secret-like files like `.env*` (except examples), keys/certs, `.DS_Store`, and `*.tsbuildinfo`
- very large files above `50 MiB` (default pre-push threshold)

If you intentionally need larger assets, use Git LFS.

Managed ignore files are auto-refreshed on commit via hooks.  
You can also refresh manually:

```bash
bash scripts/update-gitignore.sh --write
```

Quick verify that ignored paths are matched:

```bash
git check-ignore -v frontend-web/node_modules package/.env.local apps/web/.next/cache/file
```
