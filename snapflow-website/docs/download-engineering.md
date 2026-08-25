# Download Engineering

Production manifest schema:

```json
{
  "version": "2.0.0",
  "channel": "stable",
  "minSupported": "2.0.0",
  "sha256": "<installer sha256>",
  "updateBaseUrl": "https://cdn.example.com/snapflow/2.0.0/",
  "windows": {
    "setup": "https://cdn.example.com/SnapFlow-Setup-2.0.0.exe",
    "portable": "https://cdn.example.com/SnapFlow-Portable-2.0.0.exe"
  }
}
```

Use HTTPS, CDN range requests, immutable versioned artifacts, SHA-256 verification, and signed release metadata. Download counters must come from real analytics; demo counters on the static prototype are explicitly labeled demo.
