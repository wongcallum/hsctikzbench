# Notes

- **GPT-6 Sol and GPT-6 Luna image encoding.** On 2026-09-25 OpenAI [fixed a bug in image encoding](https://developers.openai.com/api/docs/changelog) that degraded image understanding in GPT-6 Sol and GPT-6 Luna, in both the API and Codex. The fix was server-side. The `gpt-6-luna` high-reasoning batch (`20261001-gpt-6-luna-high`) was run after the fix, from 2026-10-01; each sample's `result.json` records `startedAt`.
