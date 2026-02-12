import { useState, useEffect } from 'react';
import { useAdminStore } from '../../store/adminStore';
import { Settings, Save, RotateCcw } from 'lucide-react';

const SETTING_LABELS: Record<string, { label: string; type: 'number' | 'boolean'; unit?: string }> = {
    max_cpu_percent: { label: 'Max CPU per Container', type: 'number', unit: '%' },
    max_memory_mb: { label: 'Max Memory per Container', type: 'number', unit: 'MB' },
    max_runtime_seconds: { label: 'Max Execution Time', type: 'number', unit: 'seconds' },
    max_zip_size_mb: { label: 'Max ZIP Upload Size', type: 'number', unit: 'MB' },
    max_projects_per_user: { label: 'Max Projects per User', type: 'number' },
    max_executions_per_hour: { label: 'Max Executions per Hour', type: 'number' },
    auto_block_on_abuse: { label: 'Auto-Block on Abuse', type: 'boolean' },
    container_cleanup_hours: { label: 'Container Auto-Cleanup Age', type: 'number', unit: 'hours' }
};

export default function AdminSettings() {
    const { settings, loadSettings, updateSettings } = useAdminStore();
    const [editedValues, setEditedValues] = useState<Record<string, string>>({});
    const [hasChanges, setHasChanges] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');

    useEffect(() => {
        loadSettings();
    }, []);

    useEffect(() => {
        const initial: Record<string, string> = {};
        settings.forEach((s) => {
            // Parse JSON string values
            let val = s.value;
            try { val = JSON.parse(val as any); } catch (_) { /* keep raw */ }
            initial[s.key] = String(val).replace(/^"|"$/g, '');
        });
        setEditedValues(initial);
        setHasChanges(false);
    }, [settings]);

    const handleChange = (key: string, value: string) => {
        setEditedValues((prev) => ({ ...prev, [key]: value }));
        setHasChanges(true);
    };

    const handleSave = async () => {
        setSaving(true);
        setSaveMessage('');
        try {
            await updateSettings(editedValues);
            setSaveMessage('Settings saved successfully');
            setHasChanges(false);
            setTimeout(() => setSaveMessage(''), 3000);
        } catch (err: any) {
            setSaveMessage(`Error: ${err.message}`);
        } finally {
            setSaving(false);
        }
    };

    const handleReset = () => {
        const initial: Record<string, string> = {};
        settings.forEach((s) => {
            let val = s.value;
            try { val = JSON.parse(val as any); } catch (_) { /* keep raw */ }
            initial[s.key] = String(val).replace(/^"|"$/g, '');
        });
        setEditedValues(initial);
        setHasChanges(false);
    };

    return (
        <div className="admin-settings">
            <div className="admin-toolbar">
                <h3 className="toolbar-title"><Settings size={18} /> System Settings</h3>
                <div className="toolbar-actions">
                    {saveMessage && (
                        <span className={`save-message ${saveMessage.startsWith('Error') ? 'error' : 'success'}`}>
                            {saveMessage}
                        </span>
                    )}
                    <button
                        className="btn btn-sm btn-secondary"
                        onClick={handleReset}
                        disabled={!hasChanges}
                    >
                        <RotateCcw size={14} /> Reset
                    </button>
                    <button
                        className="btn btn-sm btn-primary"
                        onClick={handleSave}
                        disabled={!hasChanges || saving}
                    >
                        <Save size={14} /> {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </div>

            <div className="settings-grid">
                {Object.entries(SETTING_LABELS).map(([key, meta]) => (
                    <div key={key} className="setting-item">
                        <div className="setting-header">
                            <label>{meta.label}</label>
                            {settings.find(s => s.key === key)?.description && (
                                <span className="setting-desc">
                                    {settings.find(s => s.key === key)?.description}
                                </span>
                            )}
                        </div>
                        <div className="setting-input">
                            {meta.type === 'boolean' ? (
                                <label className="toggle-switch">
                                    <input
                                        type="checkbox"
                                        checked={editedValues[key] === 'true'}
                                        onChange={(e) => handleChange(key, e.target.checked ? 'true' : 'false')}
                                    />
                                    <span className="toggle-slider" />
                                    <span>{editedValues[key] === 'true' ? 'Enabled' : 'Disabled'}</span>
                                </label>
                            ) : (
                                <div className="input-with-unit">
                                    <input
                                        type="number"
                                        value={editedValues[key] || ''}
                                        onChange={(e) => handleChange(key, e.target.value)}
                                        min={0}
                                    />
                                    {meta.unit && <span className="unit">{meta.unit}</span>}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
