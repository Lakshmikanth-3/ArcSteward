import { suiClient, PACKAGE_ID } from '@/lib/sui-client';

export const dynamic = 'force-dynamic';
export const revalidate = 15; // Cache for 15 seconds

export async function GET() {
  try {
    // Aggregate all AgentActionEvents from the package events. gRPC's
    // EventEntry has no timestampMs (JSON-RPC's shape did) — only a
    // checkpoint sequence number, which needs a separate lookup to resolve
    // to a real timestamp. last_action_seconds_ago is dropped rather than
    // faked; recency is still available via checkpoint order (descending).
    const res = await suiClient.core.listEvents({
      filter: { eventType: `${PACKAGE_ID}::velo_wallet::AgentActionEvent` },
      limit: 1000,
      order: 'descending'
    });
    const events = res.events;

    const totalPaid = events.reduce((acc, e) => acc + BigInt((e.json as any)?.amount ?? 0), 0n);
    const totalTx = events.length;
    const uniqueAgents = new Set(events.map((e) => (e.json as any)?.agent_cap)).size;

    return Response.json({
      total_transactions: totalTx,
      total_sui_paid_mist: totalPaid.toString(),
      total_sui_paid: (Number(totalPaid) / 1e9).toFixed(4),
      unique_agents: uniqueAgents,
      last_action_seconds_ago: null,
      stale: false,
      recentEvents: events.slice(0, 50).map((e) => ({
        eventType: e.eventType,
        txDigest: e.transactionDigest,
        checkpoint: e.checkpoint,
        parsedJson: e.json,
      }))
    });
  } catch (error) {
    return Response.json({
      stale: true,
      error: 'Failed to fetch global stats'
    }, { status: 200 });
  }
}
