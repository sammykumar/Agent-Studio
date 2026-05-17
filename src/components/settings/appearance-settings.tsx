'use client';

import { useState } from 'react';
import { useSettingsStore } from '@/stores/settings-store';
import { useI18n } from '@/lib/i18n';
import {
  FONT_SCALE_OPTIONS,
  MIN_FONT_SCALE,
  MAX_FONT_SCALE,
  normalizeFontScale,
} from '@/lib/settings/provider-defaults';

const PRESET_LABEL_KEYS = ['small', 'medium', 'large', 'xlarge'] as const;
const PRESET_EPSILON = 0.0001;
const MIN_CUSTOM_PX = Math.ceil(MIN_FONT_SCALE * 16);
const MAX_CUSTOM_PX = Math.floor((MAX_FONT_SCALE - PRESET_EPSILON) * 16);

export default function AppearanceSettings() {
  const { t } = useI18n();
  const theme = useSettingsStore((state) => state.settings.theme);
  const fontSize = useSettingsStore((state) => state.settings.fontSize);
  const inactivePanelDimming = useSettingsStore((state) => state.settings.inactivePanelDimming);
  const showProviderIcons = useSettingsStore((state) => state.settings.showProviderIcons);
  const updateSettings = useSettingsStore((state) => state.updateSettings);

  // Theme and font scale are applied globally by ThemeInitializer.

  const currentScale = normalizeFontScale(fontSize);
  const currentPx = Math.round(currentScale * 16);
  const presetIndex = FONT_SCALE_OPTIONS.findIndex(
    (s) => Math.abs(s - currentScale) < PRESET_EPSILON,
  );
  const isOnPreset = presetIndex !== -1;
  const [customMode, setCustomMode] = useState(!isOnPreset);
  const showCustom = customMode || !isOnPreset;
  const selectValue = showCustom ? 'custom' : String(presetIndex);

  const handleFontSelect = (value: string) => {
    if (value === 'custom') {
      setCustomMode(true);
      return;
    }
    setCustomMode(false);
    updateSettings({ fontSize: FONT_SCALE_OPTIONS[parseInt(value, 10)] });
  };

  const handleCustomPx = (raw: string) => {
    const px = parseInt(raw, 10);
    if (!Number.isFinite(px)) return;
    const clamped = Math.min(Math.max(px, MIN_CUSTOM_PX), MAX_CUSTOM_PX);
    updateSettings({ fontSize: clamped / 16 });
  };

  return (
    <div className="space-y-4">
      <h3 className="font-medium text-(--text-primary)">{t('settings.appearance')}</h3>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-(--text-secondary)">{t('settings.theme.label')}</label>
        <select
          value={theme}
          onChange={(e) => updateSettings({ theme: e.target.value as 'light' | 'dark' | 'auto' })}
          className="w-full px-3 py-2 border border-(--input-border) rounded-md bg-(--input-bg) text-(--text-primary) focus:outline-none focus:ring-1 focus:ring-(--accent)"
        >
          <option value="light">{t('settings.theme.light')}</option>
          <option value="dark">{t('settings.theme.dark')}</option>
          <option value="auto">{t('settings.theme.auto')}</option>
        </select>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-(--text-secondary)">{t('settings.fontSize')}</label>
        <select
          value={selectValue}
          onChange={(e) => handleFontSelect(e.target.value)}
          className="w-full px-3 py-2 border border-(--input-border) rounded-md bg-(--input-bg) text-(--text-primary) focus:outline-none focus:ring-1 focus:ring-(--accent)"
        >
          {FONT_SCALE_OPTIONS.map((scale, i) => {
            const px = Math.round(scale * 16);
            return (
              <option key={i} value={String(i)}>
                {t(`settings.fontSizePresets.${PRESET_LABEL_KEYS[i]}`)} ({px}px)
              </option>
            );
          })}
          <option value="custom">{t('settings.fontSizePresets.custom')}</option>
        </select>
        {showCustom && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={MIN_CUSTOM_PX}
              max={MAX_CUSTOM_PX}
              step={1}
              value={currentPx}
              onChange={(e) => handleCustomPx(e.target.value)}
              className="w-24 px-3 py-2 border border-(--input-border) rounded-md bg-(--input-bg) text-(--text-primary) focus:outline-none focus:ring-1 focus:ring-(--accent)"
            />
            <span className="text-sm text-(--text-muted)">px</span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-(--text-secondary)">
          {t('settings.inactivePanelDimming')} ({inactivePanelDimming}%)
        </label>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={inactivePanelDimming}
          onChange={(e) => updateSettings({ inactivePanelDimming: parseInt(e.target.value) })}
          className="w-full accent-(--accent)"
        />
      </div>

      <label className="flex items-start gap-3 rounded-md border border-(--divider) bg-(--sidebar-bg) px-3 py-2.5">
        <input
          type="checkbox"
          checked={showProviderIcons}
          onChange={(e) => updateSettings({ showProviderIcons: e.target.checked })}
          className="mt-0.5 h-4 w-4 accent-(--accent)"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-(--text-secondary)">
            {t('settings.showProviderIcons')}
          </span>
          <span className="mt-0.5 block text-xs leading-5 text-(--text-muted)">
            {t('settings.showProviderIconsDesc')}
          </span>
        </span>
      </label>
    </div>
  );
}
