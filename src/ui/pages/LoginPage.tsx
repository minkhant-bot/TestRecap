import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../components';

function GoogleMark() {
  return (
    <span className="googleMark">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.32 2.98-7.41Z" />
        <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.36l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.06v2.62A10 10 0 0 0 12 22Z" />
        <path fill="#FBBC05" d="M6.41 13.94A6.03 6.03 0 0 1 6.1 12c0-.67.12-1.32.31-1.94V7.44H3.06A10 10 0 0 0 2 12c0 1.61.39 3.14 1.06 4.56l3.35-2.62Z" />
        <path fill="#EA4335" d="M12 5.94c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.94 5.44l3.35 2.62C7.2 7.7 9.4 5.94 12 5.94Z" />
      </svg>
    </span>
  );
}

const friendlyError = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code.includes('popup-closed')) return 'အကောင့်ဝင်ခြင်း ပယ်ဖျက်ခဲ့ပါသည်။ အဆင်သင့်ဖြစ်လျှင် ထပ်ကြိုးစားပါ။';
  if (code.includes('popup-blocked')) return 'ဘရောက်ဇာက Google အကောင့်ဝင်ဝင်းဒိုးကို ပိတ်ထားပါသည်။ Popup ခွင့်ပြုပြီး ထပ်ကြိုးစားပါ။';
  if (code.includes('network-request-failed')) return 'ကွန်ရက်မရရှိနိုင်ပါ။ အင်တာနက်ချိတ်ဆက်မှု စစ်ဆေးပြီး ထပ်ကြိုးစားပါ။';
  return 'Google ဖြင့် အကောင့်ဝင်၍မရပါ။ ထပ်ကြိုးစားပါ။';
};

// No reference equivalent (BlinkAutomationFull_v2.jsx's "Enter" buttons skip
// straight into the Workspace mock). Built only from reference primitives:
// .panel/.brand/.btn/.alert — no invented class namespace. Simplified to a
// single primary action (Google sign-in); no pipeline-feature copy or
// auth-vendor naming, matching the landing page's own branding.
export function LoginPage() {
  const { profile, loading, configurationError, sessionError, signInWithGoogle } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!loading && profile) {
    return <Navigate to={profile.role === 'super_admin' ? '/admin' : '/new-recap'} replace />;
  }

  const login = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (loginError) {
      setError(friendlyError(loginError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="centered-page">
      <div className="panel" aria-busy={loading || submitting} style={{ textAlign: 'center' }}>
        <div className="brand" style={{ justifyContent: 'center', marginBottom: 20 }}><span className="mark" />Blink</div>
        <h1 style={{ margin: '0 0 8px' }}>ကြိုဆိုပါတယ်</h1>
        <p className="muted" style={{ margin: '0 0 24px' }}>မြန်မာ Movie Recap ကို AI နဲ့ အလိုအလျောက် ဖန်တီးပါ</p>

        {(configurationError || sessionError || error) && (
          <div className="alert error" role="alert">{configurationError || sessionError || error}</div>
        )}

        <Button
          variant="primary"
          icon={<GoogleMark />}
          loading={loading || submitting}
          disabled={loading || Boolean(configurationError)}
          onClick={login}
          style={{ width: '100%' }}
        >
          Google ဖြင့် ဆက်လုပ်မည်
        </Button>
      </div>
    </main>
  );
}
