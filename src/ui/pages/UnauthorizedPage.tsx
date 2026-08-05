import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../components';

// No reference equivalent; minimal reuse of .centered-page/.panel.
export function UnauthorizedPage() {
  const { profile, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const disabled = (location.state as { reason?: string } | null)?.reason === 'disabled';

  return (
    <main className="centered-page">
      <div className="panel" style={{ textAlign: 'center' }}>
        <h1 style={{ margin: '0 0 8px' }}>{disabled ? 'သင့်အကောင့်ကို ပိတ်ထားပါသည်' : 'ဝင်ရောက်၍မရပါ'}</h1>
        <p className="muted">
          {disabled
            ? 'ဤအကောင့်ဖြင့် Blink ကို အသုံးပြု၍မရပါ။ မှားယွင်းသည်ဟု ယူဆပါက အကူအညီအဖွဲ့ကို ဆက်သွယ်ပါ။'
            : 'ဤစာမျက်နှာကို ဖွင့်ရန် သင့်အကောင့်တွင် ခွင့်ပြုချက်မရှိပါ။'}
        </p>
        <div className="row wrap" style={{ justifyContent: 'center', marginTop: 16 }}>
          {profile?.status === 'active' && (
            <Button onClick={() => navigate(profile.role === 'super_admin' ? '/admin' : '/new-recap')}>အလုပ်နေရာသို့ ပြန်မည်</Button>
          )}
          <Button variant="secondary" onClick={() => { void logout().then(() => navigate('/', { replace: true })); }}>အကောင့်မှ ထွက်မည်</Button>
        </div>
      </div>
    </main>
  );
}
