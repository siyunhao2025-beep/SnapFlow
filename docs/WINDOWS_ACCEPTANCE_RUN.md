# Windows acceptance run

This pull request records the first Windows x64 CI acceptance build for SnapFlow v2.0.0.

Required artifacts:

- `SnapFlow-Setup-2.0.0.exe`
- `SnapFlow-Portable-2.0.0.exe`
- `SHA256SUMS.txt`

A CI pass covers compilation, unit tests, packaging, and the packaged renderer smoke test. Physical-device checks, real provider credentials, PostgreSQL, and Stripe remain separate evidence gates.
