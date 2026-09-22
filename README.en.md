# Zhitu Atlas

[中文](README.md) · English

**Find roles worth pursuing using your own experience, then connect analysis, outreach and follow-up in one traceable workflow.**

Atlas is a local-first job-search workspace. It connects job requirements, resume evidence, recruiter conversations, interviews and offers. Version **0.22.1**; shared desktop and local web data, a Chinese-language interface, and a validated Linux x64 client.

## What makes Atlas different

| Focus | Implementation |
| --- | --- |
| Evidence-based matching | Compare JD requirements with experience confirmed by the user; distinguish supported facts, gaps and unknowns. A match score is not a hiring probability |
| Relevant outreach | Generate messages from the specific JD, relevant experience and conversation; check factual claims and optionally cite verified public work |
| Verifiable actions | Track drafts, opened conversations, personalized messages and resume attachments separately. Uncertain sends require review instead of automatic retries |
| Connected progress | Associate companies, roles, recruiters, conversations and interviews across discovery, communication, maps and statistics |
| Visible agents | Inspect coordinator plans, subtasks, current steps, proposed messages and outcomes; view and edit agent prompts |
| User-controlled data and models | Keep business data and credentials on the local machine, choose a compatible model provider, and keep sending authorization outside model control |

These are product design choices, not a claim of higher interview or hiring rates. Value should be assessed through relevance, communication quality, time saved and actual progress.

**Search / BOSS recommendations / browsing / import → deduplicate → complete JD → match confirmed experience → draft → authorized outreach → verify → follow up.** Unknown facts go to review; unsuitable roles retain an exclusion reason.

## About the author — open to opportunities

I am **Zhengfa Dong**, with **10+ years of product experience** across consumer apps, enterprise SaaS and smart hardware, including product growth, cross-functional team management and enterprise AI delivery. I am seeking **Product Lead, senior individual-contributor, or AI product roles in Shanghai**.

Atlas demonstrates how I translate a practical workflow into product capabilities, AI-assisted analysis, interaction design, implementation and verification. I welcome conversations with hiring teams about relevant needs and the code.

**WeChat: 164245026** · [GitHub](https://github.com/xydzf520) · [SkillForge](https://github.com/xydzf520/skillforge)

This is the author's intentionally public professional introduction. It is not a built-in candidate profile or the application's default job-search policy.

## Start

Check [Releases](https://github.com/xydzf520/zhitu-atlas/releases) for published packages. The complete Linux package includes its runtime: run `./start.sh`, or `./install.sh` to add it to your application menu. Neither requires Node.js or sudo. If no release is available yet, build from source; CI also provides temporary build artifacts.

Source builds require Node.js 22.13+, pnpm 8.15.9 and a Linux graphical session. Installation downloads Electron.

```bash
git clone https://github.com/xydzf520/zhitu-atlas.git
cd zhitu-atlas
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

1. Add your resume and confirm evidence that may be used in outreach.
2. Set target roles, locations, salary and exclusions. Start with manual jobs or the [blank CSV](examples/jobs-template.csv) / [fictional JSON](examples/jobs-fictional.json).
3. Optionally configure your own model and Tianditu map key; log in to your own BOSS account inside the desktop workspace.
4. Review matching and message drafts before choosing per-message confirmation or automatic contact, with limits, hours and pause controls.

Fresh installations have empty profiles and paused automation. Manual records, stages and imports work without external accounts. No shared credentials are included.

The desktop serves `http://127.0.0.1:5178/desktop.html`. After building, standalone `pnpm web` supports local data management; native BOSS actions require the desktop. Other browsers' login sessions are not shared. [First-use guide, in Chinese](docs/QUICK_START.md).

## Current scope

- Automatic contact means opening a conversation and sending a checked personalized introduction. Resume attachments, formal applications, salary commitments and interview confirmations still require user action.
- BOSS desktop integration and file imports are available. Platform changes, account restrictions and login state can affect operation; login does not establish full historical sync. Live Liepin integration is not implemented.
- Bring your own Chat Completions-compatible endpoint, local model, CommandCode or DeepSeek configuration. Test generation and tool calls; capabilities depend on the selected service.
- Maps use each user's Tianditu key. Without access, regional filters and address lists remain available. No DataV boundaries or anonymous Amap tiles are bundled.
- The complete client was verified on Ubuntu 26.04 x64. Other distributions need validation; Windows/macOS packages are not provided.
- The 0.22.1 baseline passed 503 tests, type checks, production builds, isolated installation and desktop/web workflow checks. Real map access and real BOSS sends still require account-specific acceptance. [Validation scope](docs/DISTRIBUTION_0221.md).

## Privacy and development

Business data defaults to `~/.local/share/zhitu-atlas/`; desktop sessions use `~/.local/share/zhitu-atlas-desktop/`. Credentials stay in local private configuration and are excluded from source, client packages and business migration backups.

**Local storage does not mean offline AI.** Relevant resume evidence, JDs and conversation context are sent to the model service you select. Company research and maps also make external requests. The public repository excludes the author's complete resume, job-search database, conversations, cookies, service keys and private Git history. Test profiles are fictional.

`pnpm check` runs isolated tests, type checks and production builds. `pnpm check:public:history` checks source and reachable history for suspected credentials. Build a complete client with `node scripts/atlas-package.cjs artifacts/releases/atlas-linux`.

Atlas-owned content uses [ISC](LICENSE). Preserve [third-party notices](THIRD_PARTY_NOTICES.md), [provenance](docs/PROVENANCE.md) and [map terms](docs/MAP_DATA_SOURCES.md). A clean snapshot does not erase upstream rights. The project has not undergone an independent security audit.

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Privacy](docs/PRIVACY.md) · [Operations](docs/OPERATIONS.md) · [Publication review](docs/PUBLICATION_0221.md)
