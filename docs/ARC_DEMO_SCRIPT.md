# Reviewer demo (after deployment)

Status: this is a procedure, not evidence of an executed mainnet demo.

1. Open the public `/arc` URL and show the actual mainnet chain ID 5042 and factory/vault explorer links. Connect the owner wallet; switch to Arc if needed.
2. Create a vault (or load its existing address), refresh authoritative state, then approve exactly 0.01 USDC and deposit it. Show the confirmed hash and balance.
3. Authorize a distinct funded agent address for 0.01 USDC lifetime, 0.01 per payment, one intentional recipient and a short future expiry. Show the authorization event.
4. Connect the agent wallet and load that vault, or run the dedicated server agent CLI. Pay 0.01 USDC using a unique payment ID. Show the successful receipt, `Paid` event, recipient and remaining budget. State whether recipient is your own demo account.
5. Demonstrate rejected simulations for oversized payment, exhausted budget, an unlisted recipient, expired capability and unauthorized signer. These are failed simulations, not successful on-chain transactions. Local automated contract tests cover these independently; for mainnet demonstration use separate small scoped capabilities and wait for expiry.
6. Reconnect owner, revoke agent and simulate another payment as that agent. Show the revocation event. Refresh/load earlier contract history as needed; no synthetic activity is inserted.
7. Open the actual successful payment on Arc Explorer and let reviewers reproduce the event and receipt. Explain ERC-20 USDC uses six decimals, native gas eighteen, both sharing one balance.

Do not reuse a Sui/Base transaction as proof, label local tests as Arc testnet or claim an audit. Owners approve setup transactions; authorized agents execute their own payments. No AI model reasoning engine is claimed for this payment runner.
