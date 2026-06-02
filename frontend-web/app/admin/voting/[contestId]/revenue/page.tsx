'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { authHeaders } from '@/src/lib/auth/client';
import { FORMAT_NAIRA } from '@/src/features/voting/constants';

export default function AdminRevenuePage() {
  const { contestId } = useParams() as { contestId: string };
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const headers = await authHeaders();
      const res = await fetch(`/api/admin/voting/${contestId}/revenue`, { headers });
      if (res.ok) setData(await res.json());
      setLoading(false);
    })();
  }, [contestId]);

  if (loading) return <div className="p-8 text-gray-400 animate-pulse">Loading revenue…</div>;
  if (!data) return <div className="p-8 text-red-400">Failed to load revenue data</div>;

  const statCard = (label: string, value: string, color = 'text-white') => (
    <div className="bg-gray-900 rounded-2xl p-5">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-white mb-6">Revenue Dashboard</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCard('Total Revenue', FORMAT_NAIRA(data.totalRevenue), 'text-green-400')}
        {statCard('Votes Sold', data.totalVotesSold.toLocaleString(), 'text-amber-400')}
        {statCard('Successful', String(data.successfulTransactions))}
        {statCard('Failed', String(data.failedTransactions), 'text-red-400')}
        {statCard('Pending', String(data.pendingTransactions), 'text-yellow-400')}
        {statCard('Refunded', String(data.refundedTransactions))}
        {statCard('Avg Transaction', FORMAT_NAIRA(data.averageTransactionValue))}
        {statCard('Conversion Rate', `${(data.conversionRate * 100).toFixed(1)}%`)}
      </div>

      {/* Revenue by package */}
      {data.revenueByPackage?.length > 0 && (
        <div className="bg-gray-900 rounded-2xl p-5 mb-6">
          <h2 className="text-sm font-bold text-white mb-4">Revenue by Package</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 uppercase border-b border-gray-800">
                <th className="py-2 text-left">Package</th>
                <th className="py-2 text-right">Transactions</th>
                <th className="py-2 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.revenueByPackage.map((pkg: any) => (
                <tr key={pkg.packageId} className="border-b border-gray-800/50">
                  <td className="py-2 text-white">{pkg.packageName}</td>
                  <td className="py-2 text-right text-gray-400">{pkg.count}</td>
                  <td className="py-2 text-right text-green-400 font-semibold">{FORMAT_NAIRA(pkg.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Daily revenue */}
      {data.dailyRevenue?.length > 0 && (
        <div className="bg-gray-900 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-white mb-4">Daily Revenue</h2>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {[...data.dailyRevenue].reverse().map((d: any) => (
              <div key={d.date} className="flex items-center justify-between text-sm">
                <span className="text-gray-400">{d.date}</span>
                <span className="text-gray-500">{d.transactions} tx</span>
                <span className="text-green-400 font-semibold">{FORMAT_NAIRA(d.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
