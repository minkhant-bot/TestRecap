import { LockKeyhole } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../components';

export function UnauthorizedPage() {
  const { profile, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const disabled = (location.state as { reason?: string } | null)?.reason === 'disabled';

  return (
    <main className="ds-session-state">
      <span className="ds-session-state__icon"><LockKeyhole size={24} /></span>
      <h1>{disabled ? 'သင့်အကောင့်ကို ပိတ်ထားပါသည်' : 'ဝင်ရောက်၍မရပါ'}</h1>
      <p>
        {disabled
          ? 'ဤအကောင့်ဖြင့် TestRecap ကို အသုံးပြု၍မရပါ။ မှားယွင်းသည်ဟု ယူဆပါက အကူအညီအဖွဲ့ကို ဆက်သွယ်ပါ။'
          : 'ဤစာမျက်နှာကို ဖွင့်ရန် သင့်အကောင့်တွင် ခွင့်ပြုချက်မရှိပါ။'}
      </p>
      <div className="ds-session-state__actions">
        {profile?.status === 'active' && (
          <Button onClick={() => navigate(profile.role === 'super_admin' ? '/dashboard' : '/projects')}>အလုပ်နေရာသို့ ပြန်မည်</Button>
        )}
        <Button variant="secondary" onClick={() => void logout()}>အကောင့်မှ ထွက်မည်</Button>
      </div>
    </main>
  );
}
