import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar, Button } from '../components';

// No reference equivalent; built only from .panel/.pagetitle/.field/.btn/.chip.
export function SettingsPage() {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const signOut = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  return (
    <>
      <div className="pagetitle">
        <div><span className="kicker">ACCOUNT</span><h1>ဆက်တင်များ</h1><p>အကောင့်နှင့် AI ဆက်တင်များ</p></div>
      </div>

      <div className="stack">
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>ကိုယ်ရေးအချက်အလက်</h3>
          <div className="row">
            <Avatar name={profile?.displayName || profile?.email || 'အကောင့်'} src={profile?.photoURL} size="lg" />
            <div style={{ flex: 1 }}><strong>{profile?.displayName || 'Google အကောင့်'}</strong><div className="muted">{profile?.email}</div></div>
            <span className="chip">{profile?.role === 'super_admin' ? 'စီမံခန့်ခွဲသူ' : 'အသုံးပြုသူ'}</span>
          </div>
        </div>

        <div className="panel">
          <h3 style={{ marginTop: 0 }}>အကောင့်မှ ထွက်ရန်</h3>
          <Button variant="secondary" onClick={() => void signOut()}>အကောင့်မှ ထွက်မည်</Button>
        </div>
      </div>
    </>
  );
}
