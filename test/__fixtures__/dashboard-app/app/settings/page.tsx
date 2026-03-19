'use client';

import { useState, useEffect } from 'react';
import type { UserSettings } from '@/types/analytics';
import { fetchSettings, updateSettings } from '@/lib/api';

export default function SettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    const data = await fetchSettings();
    setSettings(data);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;

    setIsSaving(true);
    try {
      await updateSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setIsSaving(false);
    }
  }

  if (!settings) {
    return <div className="animate-pulse">Loading settings...</div>;
  }

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-3xl font-bold text-gray-900">Settings</h1>

      <form onSubmit={handleSave} className="space-y-6">
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Profile</h2>
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              id="name"
              type="text"
              value={settings.name}
              onChange={(e) => setSettings({ ...settings, name: e.target.value })}
              className="w-full rounded-md border px-4 py-2"
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              id="email"
              type="email"
              value={settings.email}
              onChange={(e) => setSettings({ ...settings, email: e.target.value })}
              className="w-full rounded-md border px-4 py-2"
            />
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Notifications</h2>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={settings.notifications.email}
              onChange={(e) => setSettings({
                ...settings,
                notifications: { ...settings.notifications, email: e.target.checked },
              })}
              className="rounded"
            />
            <span className="text-sm text-gray-700">Email notifications</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={settings.notifications.push}
              onChange={(e) => setSettings({
                ...settings,
                notifications: { ...settings.notifications, push: e.target.checked },
              })}
              className="rounded"
            />
            <span className="text-sm text-gray-700">Push notifications</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={settings.notifications.sms}
              onChange={(e) => setSettings({
                ...settings,
                notifications: { ...settings.notifications, sms: e.target.checked },
              })}
              className="rounded"
            />
            <span className="text-sm text-gray-700">SMS notifications</span>
          </label>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Appearance</h2>
          <div>
            <label htmlFor="theme" className="block text-sm font-medium text-gray-700 mb-1">Theme</label>
            <select
              id="theme"
              value={settings.theme}
              onChange={(e) => setSettings({ ...settings, theme: e.target.value as UserSettings['theme'] })}
              className="w-full rounded-md border px-4 py-2"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          </div>
        </section>

        <button
          type="submit"
          disabled={isSaving}
          className="rounded-md bg-blue-600 px-6 py-2 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}
