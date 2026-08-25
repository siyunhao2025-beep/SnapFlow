# SnapFlow Website v2.0.0

Self-contained product site source: `index.html`.

```bash
npm run website:build
```

Output: `dist/site/`. Release URLs are injected through environment variables by `scripts/build-website.cjs`; without real URLs the Windows download buttons remain unpublished.

Deploy `dist/site/` to Nginx, object storage, Cloudflare R2, Aliyun OSS or any HTTPS static host. See `docs/WEBSITE_DEPLOYMENT.md` at repository root and `snapflow-website/docs/website-release.md` for release checks.
