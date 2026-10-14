# Arc security model

Solidity constraints are authoritative. The frontend and SDK pre-check each call against the live contract (eth_call) to give clear errors before signing, but grant no authority. A randomized attacker test (`app/scripts/arc-adversarial.test.mjs`), the live testnet suite (`arc-testnet-e2e.test.ts`) and the HTTP 402 suite (`arc-x402.test.ts`) verify the rules below.

## Roles

- **Owner** (immutable per vault): deposit, authorize, edit recipients, set the merchant registry, revoke, withdraw. The owner can be any address, including a multisig such as Safe, which is the recommended way to get key recovery.
- **Agent**: may only call `pay()` and `topUpGas()`, each bounded by its capability.
- **Registry curator**: approves merchants in the `MerchantRegistry`. A vault trusts a registry only if its owner sets it with `setRegistry` and authorizes an agent with `useRegistry = true`.

## Per-agent capability

Lifetime budget (`maxTotal`, includes gas top-ups), per-payment limit, daily limit (resets each UTC day), gas allowance, expiry, versioned recipient allowlist and optional registry use. Updates preserve lifetime spend, gas drawn and used invoice hashes; each authorization starts a new recipient version. Budgets are ceilings, not reserved balances; several agents compete for the vault balance.

`pay()` checks, in order: active, not expired, recipient allowed, non-zero amount and ID, invoice unused, per-payment limit, lifetime budget, daily limit, balance. `topUpGas()` checks gas allowance, then the same active, expiry, lifetime, daily and balance rules, and pays only the agent itself. State changes precede the token transfer; a failed transfer rolls all accounting back. OpenZeppelin SafeERC20 and ReentrancyGuard protect transfers. Recipients exclude zero, the vault and the agent itself; lists are capped at 100. Lowered limits cannot underflow: if spend already exceeds a new limit, further spending is refused.

## What this bounds, and what it does not

- A prompt-injected agent or a stolen agent key can spend at most the remaining budget, at most the daily limit per day, only to allowed recipients. The daily limit gives the owner time to notice an alert and revoke.
- It cannot judge service quality: an allowed merchant can still sell poor data. Invoice hashes bind each payment to one order; escrow (pay on delivery) is planned as a separate contract.
- An approved registry merchant is trusted by every vault that opts in. Opt in only to registries you trust.
- Owner key compromise gives full control of that vault; use a multisig owner for larger balances.
- Revocation takes effect after chain inclusion and cannot reverse completed payments.
- USDC behaviour, Arc RPC and the explorer are external dependencies. Verify receipts on the explorer.

## HTTP 402 verification

The API accepts a payment proof only if the transaction succeeded, contains a USDC `Transfer` from a vault to the merchant for at least the price, the vault was created by the configured factory, and the vault's `Paid` event carries `paymentId == keccak256(invoice)` for this resource. Invoices expire after 5 minutes. A proof can unlock its own resource until the invoice expires.

## Not yet done

No independent audit. Vaults hold Arc USDC only (fee-on-transfer tokens are rejected by the deposit balance check).
