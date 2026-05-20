# spotlight-latest

## Git Safety Setup

Run once after cloning:

```bash
bash scripts/install-git-hooks.sh
```

This repo is configured to prevent accidental pushes of:

- generated build caches like `.next/` and `.npm-cache/`
- local-only files like `.env.local`, `.DS_Store`, and `*.tsbuildinfo`
- very large files above `50 MiB` (default pre-push threshold)

If you intentionally need larger assets, use Git LFS.
