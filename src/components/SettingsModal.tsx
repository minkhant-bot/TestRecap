import { Eye, EyeOff, Save, Trash } from 'lucide-react';

interface SettingsModalProps {
    showSettings: boolean;
    setShowSettings: (val: boolean) => void;
    settings: any;
    editSettings: any;
    setEditSettings: (val: any) => void;
    saveSetting: (key: string, value: string) => void;
    deleteSetting: (key: string) => void;
    settingsSaving: boolean;
    showKeys: Record<string, boolean>;
    setShowKeys: (val: Record<string, boolean>) => void;
}

export function SettingsModal({
    showSettings, setShowSettings, settings, editSettings, setEditSettings,
    saveSetting, deleteSetting, settingsSaving, showKeys, setShowKeys
}: SettingsModalProps) {
    if (!showSettings) return null;
    const key = 'GEMINI_API_KEY';
    const isConfigured = settings[key]?.configured;
    const isEditing = editSettings[key] !== undefined;
    const editValue = editSettings[key] || '';

    return (
        <div className="modal-backdrop" onMouseDown={() => setShowSettings(false)}>
            <section className="sheet" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Settings">
                <div className="sheet-header">
                    <div><h2>ဆက်တင်များ</h2><p>အသုံးပြုမှုနှင့် ထုတ်လုပ်မှု</p></div>
                    <button className="icon-button" onClick={() => setShowSettings(false)} aria-label="Close">×</button>
                </div>
                <div className="sheet-content custom-scrollbar">
                    <div className="settings-group">
                        <div className="group-label">API access</div>
                        <div className="modal-setting-row">
                            <div><strong>Gemini API key</strong><small className={isConfigured ? 'success-text' : 'warning-text'}>{isConfigured ? 'ထည့်သွင်းထားပြီး' : 'ထည့်သွင်းရန် လိုအပ်သည်'}</small></div>
                            {!isEditing && <div className="row-actions"><button onClick={() => setEditSettings({ ...editSettings, [key]: '' })}>{isConfigured ? 'လဲလှယ်ရန်' : 'ထည့်ရန်'}</button>{isConfigured && <button className="danger-action" onClick={() => deleteSetting(key)} disabled={settingsSaving} aria-label="Delete key"><Trash size={15} /></button>}</div>}
                        </div>
                        {isEditing && <div className="key-editor"><div className="input-wrap"><input type={showKeys[key] ? 'text' : 'password'} value={editValue} onChange={e => setEditSettings({ ...editSettings, [key]: e.target.value })} placeholder="Gemini API key" autoFocus /><button onClick={() => setShowKeys({ ...showKeys, [key]: !showKeys[key] })}>{showKeys[key] ? <EyeOff size={16} /> : <Eye size={16} />}</button></div><button className="save-button" onClick={() => saveSetting(key, editValue)} disabled={settingsSaving || !editValue}><Save size={16} /></button><button onClick={() => setEditSettings({ ...editSettings, [key]: undefined })}>Cancel</button></div>}
                        <p className="privacy-note">API key ကို ဤ browser ၏ local storage တွင်သာ သိမ်းဆည်းထားပါသည်။</p>
                    </div>
                    <div className="settings-group">
                        <div className="group-label">Output</div>
                        <label className="modal-setting-row" htmlFor="output-speed"><span><strong>ဗီဒီယိုအမြန်နှုန်း</strong><small>အသံနှင့် ဗီဒီယို နှစ်ခုစလုံး</small></span><select id="output-speed" value={editSettings['OUTPUT_SPEED_MULTIPLIER'] !== undefined ? editSettings['OUTPUT_SPEED_MULTIPLIER'] : (settings['OUTPUT_SPEED_MULTIPLIER']?.value || '1.0')} onChange={e => { setEditSettings({ ...editSettings, OUTPUT_SPEED_MULTIPLIER: e.target.value }); saveSetting('OUTPUT_SPEED_MULTIPLIER', e.target.value); }}><option value="1.0">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="1.75">1.75×</option><option value="2.0">2×</option><option value="2.5">2.5×</option><option value="3.0">3×</option></select></label>
                    </div>
                </div>
                <div className="sheet-footer"><button className="primary-button compact-button" onClick={() => setShowSettings(false)}>ပြီးပါပြီ</button></div>
            </section>
        </div>
    );
}
