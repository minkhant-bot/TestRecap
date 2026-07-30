import { ArrowRight, Coins, FolderOpen, Plus, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar, Badge, Button, Card, EmptyState, ErrorPanel, Skeleton } from '../components';
import { JobList } from '../workspace/JobList';
import { useWorkspaceJobs } from '../workspace/useWorkspaceJobs';

export function DashboardPage() {
  const { profile } = useAuth();
  const { jobs, loading, error, refresh } = useWorkspaceJobs(5);
  const navigate = useNavigate();
  const firstName = profile?.displayName?.trim().split(/\s+/)[0] || 'ဖန်တီးသူ';

  return (
    <div className="ds-page-container workspace-page">
      <header className="workspace-welcome">
        <div>
          <h1>ပြန်လည်ကြိုဆိုပါတယ်၊ {firstName}</h1>
        </div>
        <Button size="lg" icon={<Plus size={18} />} onClick={() => navigate('/projects/new')}>Recap အသစ်</Button>
      </header>

      <div className="workspace-summary-grid">
        <Card className="workspace-account-card">
          <Avatar name={profile?.displayName || profile?.email || 'အကောင့်'} src={profile?.photoURL} size="lg" />
          <div>
            <strong>{profile?.displayName || 'Google အကောင့်'}</strong>
            <small>{profile?.email}</small>
          </div>
          <Badge tone="accent"><ShieldCheck size={13} /> {profile?.role === 'super_admin' ? 'စီမံခန့်ခွဲသူ' : 'အသုံးပြုသူ'}</Badge>
        </Card>
        <Card className="workspace-credit-card">
          <span className="workspace-summary-icon"><Coins size={20} /></span>
          <div><span>ခရက်ဒစ်</span><strong>မရရှိနိုင်သေးပါ</strong></div>
        </Card>
      </div>

      <Card
        title="လတ်တလော လုပ်ငန်းများ"
        action={<Button variant="ghost" size="sm" icon={<ArrowRight size={15} />} onClick={() => navigate('/projects')}>ဖွင့်မည်</Button>}
      >
        {loading && (
          <div className="workspace-loading-list">
            <Skeleton height="4.5rem" /><Skeleton height="4.5rem" /><Skeleton height="4.5rem" />
          </div>
        )}
        {!loading && error && (
          <ErrorPanel title="လတ်တလော လုပ်ငန်းများ မရရှိနိုင်ပါ" description={error} action={{ label: 'ထပ်ကြိုးစားမည်', onClick: () => void refresh() }} />
        )}
        {!loading && !error && jobs.length === 0 && (
          <EmptyState
            icon={FolderOpen}
            title="ပရောဂျက် မရှိသေးပါ"
            action={{ label: 'ဗီဒီယိုတင်မည်', onClick: () => navigate('/projects/new') }}
          />
        )}
        {!loading && !error && jobs.length > 0 && <JobList jobs={jobs} compact />}
      </Card>
    </div>
  );
}
