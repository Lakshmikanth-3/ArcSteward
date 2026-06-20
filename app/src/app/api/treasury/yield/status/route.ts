import { suiClient } from '@/lib/sui-client';

// Pyth SUI/USD feed (same as Guardian)
const PYTH_SUI_USD_ID = "23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744";

async function fetchSuiUsdPrice(): Promise<number> {
  try {
    const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${PYTH_SUI_USD_ID}`;
    const resp = await fetch(url, { next: { revalidate: 30 } });
    const data = await resp.json();
    const parsed = data?.parsed?.[0];
    if (!parsed) return 0;
    return Number(parsed.price.price) * Math.pow(10, parsed.price.expo);
  } catch {
    return 0;
  }
}

async function fetchScallopData(): Promise<{ apy: number; exchangeRate: number }> {
  try {
    const resp = await fetch("https://sui.api.scallop.io/v1/asset?symbol=sui", { next: { revalidate: 60 } });
    if (!resp.ok) throw new Error(`Scallop API ${resp.status}`);
    const data = await resp.json();
    const supplyApy = Number(data?.data?.supplyApy ?? 0);
    const exchangeRate = Number(data?.data?.exchangeRate ?? 1);
    return { apy: supplyApy, exchangeRate };
  } catch {
    return { apy: 0, exchangeRate: 1.0 };
  }
}

export async function GET() {
  try {
    const treasury = await suiClient.getObject({
      id: process.env.NEXT_PUBLIC_TREASURY_ID!,
      options: { showContent: true },
    });
    
    const fields = (treasury.data?.content as any)?.fields;
    const principalMist = BigInt(fields?.balance ?? 0);
    const yieldPositionMist = BigInt(fields?.yield_position?.fields?.balance?.fields?.value ?? 0);

    // Scallop exchange rate (sCoin → SUI)
    const scallopData = await fetchScallopData();
    const scallopRate = scallopData.exchangeRate;
    const accruedYieldMist = BigInt(Math.floor(Number(yieldPositionMist) * scallopRate)) - yieldPositionMist;
    const apy = scallopData.apy;
    const runwayExtension = Number(accruedYieldMist) / 50_000_000; // KNOWLEDGE_PRICE_MIST

    const suiUsdPrice = await fetchSuiUsdPrice();
    const balanceSui = Number(principalMist) / 1e9;
    const balanceUsd = balanceSui * suiUsdPrice;

    return Response.json({
      principal_mist: principalMist.toString(),
      yield_position_mist: yieldPositionMist.toString(),
      accrued_yield_mist: accruedYieldMist.toString(),
      apy_bps: Math.round(apy * 10000),
      runway_extension_invoices: Math.floor(runwayExtension),
      exchange_rate: scallopRate,
      balance_usd: balanceUsd.toFixed(2),
      stale: false,
    });
  } catch {
    return Response.json({ stale: true, error: 'Yield status temporarily unavailable' }, { status: 200 });
  }
}
