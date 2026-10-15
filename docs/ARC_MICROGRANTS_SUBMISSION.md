# Arc Microgrants submission — form answers

**Link to your live deployment on Arc mainnet**
https://velo402.vercel.app/arc (Arc mainnet console; proofs at /infrastructure and /security)

**Arc mainnet contract address or a transaction hash we can verify**
Factory `0x333af5f858a1cc267b6ab16e83bcb2fe28f8b2b1` · AI-agent payment tx `0xee745efaace3a156f09ae07b4d9e1e47204075d8cf192114c378f01e6ee1eedd` (https://explorer.arc.io/tx/0xee745efaace3a156f09ae07b4d9e1e47204075d8cf192114c378f01e6ee1eedd)

**Public repo**
https://github.com/Lakshmikanth-3/velo-arc

**In two sentences, what does your project do?**
Velo402 gives autonomous AI agents restricted authority to spend USDC through an owner-controlled vault. Owners set a lifetime budget, per-payment limit, recipient allowlist and expiry, and can revoke at any time; the contract enforces every rule, so even a prompt-injected agent or stolen agent key cannot spend outside them.

**What does it use Arc for?**
Arc hosts the vault and factory contracts and settles every agent payment in USDC on-chain. Because Arc uses USDC for gas, an agent only ever holds and reasons about one dollar-denominated asset, which makes budgets exact and machine-to-machine payments simple; every payment, authorization and revocation is a verifiable Arc transaction.

**Had you deployed to Arc before this project?**
No (first Arc deployment).

**Have you received a Circle or Arc grant, bounty, or prize for this project?**
No.

**Anything else we should see?**
- Security proof (threat model + live receipts): https://velo402.vercel.app/security
- Randomized attacker test: hundreds of malicious transactions per seed; after every one, on-chain spend must equal permitted payments and the attacker must hold zero USDC (`pnpm arc:test`).
- A real AI agent paid an HTTP 402 API on Arc mainnet (txs in the README) and ignored a prompt injection; the vault rejects it anyway.
- Demo video (5:22): <paste your YouTube or Loom link here>
- Full end-to-end runs on Arc testnet with real transactions, including a Playwright click-through of the live site (`pnpm arc:testnet:e2e`, `pnpm arc:testnet:browser`).
- Builder profile: https://github.com/Lakshmikanth-3
