This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## OpenClaw QMD Memory Quick Start

This project includes a one-click script to optimize OpenClaw memory retrieval and attempt enabling the QMD backend.

Requirements:

- OpenClaw version >= 2026.2.2
- The script will try to install `bun`, `qmd`, and `sqlite3` automatically when missing.

Run optimization without restart:

```bash
npm run qmd:enable
```

Run optimization and restart gateway service:

```bash
npm run qmd:enable:restart
```

What the script does:

- Enables hybrid memory search tuning (vector + BM25 + MMR + temporal decay).
- Ensures each agent workspace has a memory/ directory.
- Attempts to enable QMD (`memory.backend = "qmd"`, `memory.qmd.limits.timeoutMs = 8000`).
- Automatically falls back to `memory-core` if validation fails.
- Forces one memory reindex and prints deep memory status summary.

Official docs used:

- https://docs.openclaw.ai/concepts/memory
- https://docs.openclaw.ai/cli/memory
- https://docs.openclaw.ai/gateway/configuration-reference
