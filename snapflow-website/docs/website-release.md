# Website Release Gate

1. Run `npm run website:build`.
2. Open `dist/site/index.html` offline and verify theme, menu, interactions and responsive layout.
3. Test 375px, 768px, 1440px.
4. Run Lighthouse: target Performance >=90 and Accessibility >=95.
5. Replace placeholder artifact names/manifest with the real signed Windows release.
6. Never publish fake macOS binaries or fake download statistics.
