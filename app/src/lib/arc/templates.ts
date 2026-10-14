// Starting policies for common agent jobs; the owner still chooses the agent and recipients.
export const templates = [
  { name: 'API agent', summary: '5 USDC total, 0.10 per call, 1 per day, 7 days', total: '5', perPayment: '0.1', perDay: '1', gas: '0.2', hours: 24 * 7 },
  { name: 'Research agent', summary: '20 USDC total, 2 per purchase, 5 per day, 30 days', total: '20', perPayment: '2', perDay: '5', gas: '0.5', hours: 24 * 30 },
  { name: 'Trading bot data feed', summary: '50 USDC total, 0.50 per call, 10 per day, 30 days', total: '50', perPayment: '0.5', perDay: '10', gas: '1', hours: 24 * 30 },
  { name: 'One-off task', summary: '1 USDC total, 1 per payment, 1 hour', total: '1', perPayment: '1', perDay: '1', gas: '0.05', hours: 1 },
] as const;
