/**
 * One-off diagnostic: prints the Base Sepolia settlement wallet address and
 * its ETH + USDC balances. Never logs the private key.
 */
import { createPublicClient, http, formatEther, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { getBaseChainConfig, getSettlementNetwork } from "../src/lib/rooster/config";

const BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

async function main() {
  const network = getSettlementNetwork();
  const chainCfg = getBaseChainConfig(network);
  const account = privateKeyToAccount(chainCfg.privateKey);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(chainCfg.rpcUrl),
  });

  const [ethBalance, usdcBalance] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({
      address: chainCfg.usdcContract,
      abi: BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [account.address],
    }),
  ]);

  console.log("network:", network);
  console.log("address:", account.address);
  console.log("ETH balance:", formatEther(ethBalance), "ETH");
  console.log("USDC balance:", formatUnits(usdcBalance, 6), "USDC");
}

main().catch((err) => {
  console.error("Failed to check balance:", err.message ?? err);
  process.exit(1);
});
