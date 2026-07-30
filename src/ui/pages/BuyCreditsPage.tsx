import { Coins } from 'lucide-react';
import { Card, EmptyState } from '../components';

export function BuyCreditsPage() {
  return (
    <div className="ds-page-container workspace-page">
      <header className="workspace-page-header">
        <h1>ခရက်ဒစ် ဝယ်ယူမည်</h1>
      </header>
      <Card>
        <EmptyState icon={Coins} title="မကြာမီ ရရှိနိုင်ပါမည်" />
      </Card>
    </div>
  );
}
