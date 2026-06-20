import { suiClient, PACKAGE_ID } from '@/lib/sui-client';

export const dynamic = 'force-dynamic';
export const revalidate = 15; // Cache for 15 seconds

export async function GET() {
  try {
    // Aggregate all AgentActionEvents from the package events
    const events = await suiClient.queryEvents({
      query: { MoveEventType: `${PACKAGE_ID}::velo_wallet::AgentActionEvent` },
      limit: 1000,
      order: 'descending'
    });
    
    const totalPaid = events.data.reduce((acc, e) => acc + BigInt((e.parsedJson as any).amount), 0n);
    const totalTx = events.data.length;
    const uniqueAgents = new Set(events.data.map((e) => (e.parsedJson as any).agent_cap)).size;
    const lastActionSecondsAgo = events.data.length > 0 
      ? Math.floor((Date.now() - new Date(events.data[0].timestampMs ?? 0).getTime()) / 1000)
      : 0;

    return Response.json({
      total_transactions: totalTx,
      total_sui_paid_mist: totalPaid.toString(),
      total_sui_paid: (Number(totalPaid) / 1e9).toFixed(4),
      unique_agents: uniqueAgents,
      last_action_seconds_ago: lastActionSecondsAgo,
      stale: false,
      recentEvents: events.data.slice(0, 50).map((e) => ({
        eventType: e.type,
        txDigest: e.id.txDigest,
        timestampMs: e.timestampMs,
        parsedJson: e.parsedJson,
      }))
    });
  } catch (error) {
    return Response.json({
      stale: true,
      error: 'Failed to fetch global stats'
    }, { status: 200 });
  }
}
