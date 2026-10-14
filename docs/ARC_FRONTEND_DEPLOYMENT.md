# Public frontend deployment

Published on October 14, 2026 through the owner's existing Vercel account.

- Public site: https://velo-arc-zeta.vercel.app
- Real testnet console: https://velo-arc-zeta.vercel.app/testnet
- Mainnet console target: https://velo-arc-zeta.vercel.app/arc
- Readiness checklist: https://velo-arc-zeta.vercel.app/submission
- Vercel project: `velo-arc`, personal Hobby team.
- Git source: `Lakshmikanth-3/velo-arc`, production branch `main`.
- Framework: Next.js; root directory: `app/`; standard detected build/install commands.
- Initial deployed commit: `43f20703e331a67f1a5962e07ca09a4fbab37abe`.
- Initial deployment ID: `dpl_CeXEHYDqgCgK399eo8kCUNZLi7XF`.

No private environment values or wallet keys were supplied to Vercel. The optional Supabase integration was not added. GitHub import uses the committed source; ignored local files are not uploaded.

## Verification

Unauthenticated HTTP requests to `/`, `/arc`, `/testnet`, `/infrastructure` and `/submission` returned 200 with the Velo402 application. The hosted testnet console successfully refreshed real chain state and events: vault balance 0 USDC, capability revoked, total spent 0.03 USDC and remaining budget 0 USDC. Paid, Revoked and Withdrawn event links point to actual Arc Testnet explorer receipts.

This verifies hosted frontend availability and real testnet reads. The in-app browser has no injected signing wallet; full hosted signing still needs a user-controlled EVM wallet. The full owner/agent transaction flow passed the existing local EVM browser integration test separately.

## Mainnet remains pending

The public `/arc` console targets chain 5042 but has no verified mainnet factory configured. Factory/vault deployment, a real mainnet payment, hosted mainnet signing verification and separate approval for mainnet spending remain pending. Public hosting does not turn a testnet prototype into an eligible mainnet submission.
