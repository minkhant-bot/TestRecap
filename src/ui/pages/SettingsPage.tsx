import { CheckCircle2, KeyRound, LogOut, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar, Badge, Button, Card, Input, StatusBadge } from '../components';
import { useGeminiKey } from '../workspace/GeminiKeyContext';

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
    navigate('/login', { replace: true });
  };

  return (
    <div className="ds-page-container workspace-page">
      <header className="workspace-page-header">
        <h1>ဆက်တင်များ</h1>
        <p>အကောင့်နှင့် AI ဆက်တင်များ</p>
      </header>

      <div className="workspace-settings-grid">
        <Card title="ကိုယ်ရေးအချက်အလက်">
          <div className="workspace-profile">
            <Avatar name={profile?.displayName || profile?.email || 'အကောင့်'} src={profile?.photoURL} size="lg" />
            <div><strong>{profile?.displayName || 'Google အကောင့်'}</strong><span>{profile?.email}</span></div>
            <Badge tone="accent"><ShieldCheck size={13} />{profile?.role === 'super_admin' ? 'စီမံခန့်ခွဲသူ' : 'အသုံးပြုသူ'}</Badge>
          </div>
        </Card>

        <Card title={isGeminiSetup ? 'Gemini API Key လိုအပ်ပါသည်' : 'Gemini API Key'}>
          <div className="workspace-key-settings">
            {isGeminiSetup && <p className="ds-modal-copy">ပထမဆုံး Recap ဖန်တီးရန် Gemini API Key ထည့်ပေးပါ။</p>}
            <div className="workspace-key-status">
              <StatusBadge status={hasApiKey ? 'complete' : 'queued'}>
                {hasApiKey ? 'Key ရှိပါသည်' : 'Key လိုအပ်ပါသည်'}
              </StatusBadge>
            </div>
            <Input
              label={hasApiKey ? 'Gemini API Key ပြောင်းမည်' : 'Gemini API Key'}
              type="password"
              autoComplete="off"
              leadingIcon={<KeyRound size={17} />}
              value={draftKey}
              onChange={event => {
                setDraftKey(event.target.value);
                setSaved(false);
                setVerificationError(null);
              }}
            />
            <div className="workspace-key-actions">
              <Button
                icon={<CheckCircle2 size={16} />}
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
                  icon={<Trash2 size={16} />}
                  onClick={() => {
                    void clearApiKey();
                    setSaved(false);
                  }}
                >
                  ဖယ်ရှားမည်
                </Button>
              )}
            </div>
            {saved && <p className="workspace-inline-success" role="status">သိမ်းပြီးပါပြီ</p>}
            {verificationError && (
              <div className="workspace-upload-error" role="alert" style={{ whiteSpace: 'pre-wrap' }}>
                {verificationError}
              </div>
            )}
            {hasApiKey && <span className="ds-sr-only">ဤအကောင့်တွင် Gemini API Key ရှိပါသည်။</span>}
          </div>
        </Card>

        <Card title="အကောင့်မှ ထွက်ရန်">
          <Button variant="secondary" icon={<LogOut size={17} />} onClick={() => void signOut()}>အကောင့်မှ ထွက်မည်</Button>
        </Card>
      </div>
    </div>
  );
}
