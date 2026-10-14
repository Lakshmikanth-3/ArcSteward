# Arc security model

Solidity constraints are authoritative. The frontend and SDK pre-check each call against the live contract (eth_call) to give clear errors before signing, but grant no authority. A randomized attacker test (`app/scripts/arc-adversarial.test.mjs`) and live testnet runs verify the rules below.

Owner is immutable. Only owner can deposit through the deposit method, grant/revoke or withdraw. Any account can send USDC directly; direct transfers increase the authoritative ERC-20 balance but do not emit `Funded`. Native sends through ordinary calldata are rejected; forced native balance can still appear in Arc's shared ERC-20 view. No double-counting or yield strategy exists in the Arc implementation.

Each agent has a lifetime spend total, maximum per-payment amount, timestamp expiry and a versioned recipient allowlist. Updates preserve spend and replace the active recipient version. Reauthorization after revocation preserves spending and used payment IDs. Owners must raise the lifetime ceiling deliberately to issue additional budget. Budgets are ceilings, not reserved balances; several agents compete for available funds. Only an agent's transaction sender can use that agent's capability.

The contract checks authorization, expiry (`timestamp >= expiry` rejected), allowlist, nonzero amount/ID, duplicate ID, transaction limit, cumulative limit and token balance. State changes precede token transfer; a failed transfer rolls all accounting back. OpenZeppelin SafeERC20 and ReentrancyGuard protect external transfers. Input recipients exclude zero and the vault itself; lists are capped at 100. Solidity 0.8 checked arithmetic is used. No arbitrary call, delegatecall, upgrade, cross-chain bridge or gas sponsorship interface exists.

Risks: owner key compromise gives full control; agent compromise can spend its authorized remaining budget to permitted recipients. Prompt injection is bounded financially but cannot establish service quality or prevent an agent from wasting its valid budget. USDC interface/admin behavior and chain RPC remain external dependencies. A spoofed website, wallet provider or RPC can mislead users; verify explorer receipts independently. Revocation is effective only after chain inclusion, and cannot reverse completed payments. There is no owner recovery, multisig provisioning, account abstraction, off-chain invoice attestation or merchant delivery guarantee. Timestamp-based expiry uses chain time.

Use dedicated keys for the Arc owner and agent. Arc signing runs in the wallet or dedicated server CLI; no new remote signing API accepts arbitrary requests. Keys are absent from browser code and public env names. Local testing uses disposable generated accounts. Never expose a funded local Ganache service publicly.

The UI's generic vault address input validates token and contract reads but is not a source-verification tool; only use vaults created by a independently verified project factory. The readiness checker verifies a factory creation input and registered vault, but current UI functionality and program acceptance remain manual checks. Source verification and an independent audit have not been completed.

