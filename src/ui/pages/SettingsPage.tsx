import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar, Button, Input, StatusBadge } from '../components';
import { useGeminiKey } from '../workspace/GeminiKeyContext';

// No reference equivalent; built only from .panel/.pagetitle/.field/.btn/.chip.
export function SettingsPage() {
  const { profile, logout } = useAuth();
  const { hasApiKey, saveApiKey, clearApiKey } = useGeminiKey();
  const [draftKey, setDraftKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const setupState = location.state as { geminiSetup?: boolean; returnTo?: string } | null;
  const isGeminiSetup = Boolean(setupState?.geminiSetup && !hasApiKey);
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
          <h3 style={{ marginTop: 0 }}>{isGeminiSetup ? 'Gemini API Key လိုအပ်ပါသည်' : 'Gemini API Key'}</h3>
          {isGeminiSetup && <p className="muted">ပထမဆုံး Recap ဖန်တီးရန် Gemini API Key ထည့်ပေးပါ။</p>}
          <div style={{ marginBottom: 14 }}><StatusBadge status={hasApiKey ? 'complete' : 'queued'}>{hasApiKey ? 'Key ရှိပါသည်' : 'Key လိုအပ်ပါသည်'}</StatusBadge></div>
          <Input
            label={hasApiKey ? 'Gemini API Key ပြောင်းမည်' : 'Gemini API Key'}
            type="password"
            autoComplete="off"
            value={draftKey}
            onChange={event => {
              setDraftKey(event.target.value);
              setSaved(false);
              setVerificationError(null);
            }}
          />
          <div className="row wrap">
            <Button
              loading={verifying}
              disabled={!draftKey.trim() || verifying}
              onClick={async () => {
                setVerifying(true);
                setVerificationError(null);
                try {
                  await saveApiKey(draftKey);
                  setDraftKey('');
                  setSaved(true);
                  if (setupState?.returnTo) navigate(setupState.returnTo, { replace: true });
                } catch (error) {
                  setVerificationError(
                    error instanceof Error
                      ? error.message
                      : 'Gemini API Key ကို စစ်ဆေး၍ မရပါ။ မှန်ကန်သော Key ထည့်ပြီး ထပ်မံကြိုးစားပါ။',
                  );
                } finally {
                  setVerifying(false);
                }
              }}
            >
              {isGeminiSetup ? 'သိမ်းပြီး ဆက်လုပ်မည်' : 'သိမ်းမည်'}
            </Button>
            {isGeminiSetup && (
              <Button variant="ghost" disabled={verifying} onClick={() => navigate('/history', { replace: true })}>
                မလုပ်တော့ပါ
              </Button>
            )}
            {hasApiKey && (
              <Button
                variant="ghost"
                onClick={() => {
                  void clearApiKey();
                  setSaved(false);
                }}
              >
                ဖယ်ရှားမည်
              </Button>
            )}
          </div>
          {saved && <p style={{ color: 'var(--success)', margin: '10px 0 0' }} role="status">သိမ်းပြီးပါပြီ</p>}
          {verificationError && (
            <div className="alert error" role="alert" style={{ whiteSpace: 'pre-wrap', marginTop: 10 }}>
              {verificationError}
            </div>
          )}
          {hasApiKey && <span className="sr-only">ဤအကောင့်တွင် Gemini API Key ရှိပါသည်။</span>}
        </div>

        <div className="panel">
          <h3 style={{ marginTop: 0 }}>အကောင့်မှ ထွက်ရန်</h3>
          <Button variant="secondary" onClick={() => void signOut()}>အကောင့်မှ ထွက်မည်</Button>
        </div>
      </div>
    </>
  );
}
