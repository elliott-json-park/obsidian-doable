import { App, normalizePath, PluginSettingTab, Setting } from 'obsidian';
import { t } from './i18n';
import type DoablePlugin from './main';

export interface Settings {
  target: 'inbox' | 'daily';
  inbox: string;
  heading: string;
  filterTag: string;
  ignore: string[];
  doneDate: boolean;
  createdDate: boolean;
  nextBelow: boolean;
  chips: boolean;
  weekStart: 'auto' | 'mon' | 'sun';
  days: number;
  /** Sections the reader folded away. */
  folded: string[];
  importedFromTasks: boolean;
}

export const DEFAULTS: Settings = {
  target: 'inbox',
  inbox: 'Inbox.md',
  heading: '',
  filterTag: '',
  ignore: [],
  doneDate: true,
  createdDate: false,
  nextBelow: false,
  chips: true,
  weekStart: 'auto',
  days: 7,
  folded: ['anytime', 'done'],
  importedFromTasks: false,
};

export class DoableSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: DoablePlugin) {
    super(app, plugin);
  }

  display(): void {
    const el = this.containerEl;
    el.empty();
    const s = this.plugin.settings;
    const save = async (reindex = false) => {
      await this.plugin.saveSettings();
      if (reindex) await this.plugin.index.rebuild();
    };

    new Setting(el).setName(t('settings.add')).setHeading();
    new Setting(el).setName(t('settings.target')).setDesc(t('settings.targetDesc'))
      .addDropdown(d => d
        .addOption('inbox', t('settings.target.inbox'))
        .addOption('daily', t('settings.target.daily'))
        .setValue(s.target)
        .onChange(async v => { s.target = v === 'daily' ? 'daily' : 'inbox'; await save(); this.display(); }));
    if (s.target === 'inbox') {
      new Setting(el).setName(t('settings.inbox')).setDesc(t('settings.inboxDesc'))
        .addText(x => x.setPlaceholder('Inbox.md').setValue(s.inbox).onChange(async v => {
          const p = normalizePath(v.trim() || 'Inbox.md');
          s.inbox = p.endsWith('.md') ? p : `${p}.md`;
          await save();
        }));
    }
    new Setting(el).setName(t('settings.heading')).setDesc(t('settings.headingDesc'))
      .addText(x => x.setPlaceholder('Tasks').setValue(s.heading).onChange(async v => { s.heading = v.trim().replace(/^#+\s*/, ''); await save(); }));
    new Setting(el).setName(t('settings.created'))
      .addToggle(x => x.setValue(s.createdDate).onChange(async v => { s.createdDate = v; await save(); }));

    new Setting(el).setName(t('settings.tasks')).setHeading();
    new Setting(el).setName(t('settings.filter')).setDesc(t('settings.filterDesc'))
      .addText(x => x.setPlaceholder('#task').setValue(s.filterTag).onChange(async v => {
        const tag = v.trim();
        s.filterTag = tag && !tag.startsWith('#') ? `#${tag}` : tag;
        await save(true);
      }));
    new Setting(el).setName(t('settings.ignore')).setDesc(t('settings.ignoreDesc'))
      .addTextArea(x => x.setPlaceholder('Templates\nArchive').setValue(s.ignore.join('\n')).onChange(async v => {
        s.ignore = v.split('\n').map(l => l.trim().replace(/\/+$/, '')).filter(Boolean);
        await save(true);
      }));

    new Setting(el).setName(t('settings.completion')).setHeading();
    new Setting(el).setName(t('settings.doneDate')).setDesc(t('settings.doneDateDesc'))
      .addToggle(x => x.setValue(s.doneDate).onChange(async v => { s.doneDate = v; await save(); }));
    new Setting(el).setName(t('settings.nextBelow')).setDesc(t('settings.nextBelowDesc'))
      .addToggle(x => x.setValue(s.nextBelow).onChange(async v => { s.nextBelow = v; await save(); }));

    new Setting(el).setName(t('settings.look')).setHeading();
    new Setting(el).setName(t('settings.chips')).setDesc(t('settings.chipsDesc'))
      .addToggle(x => x.setValue(s.chips).onChange(async v => { s.chips = v; await save(); this.plugin.refreshEditors(); }));
    new Setting(el).setName(t('settings.week'))
      .addDropdown(d => d
        .addOption('auto', t('settings.week.auto'))
        .addOption('mon', t('settings.week.mon'))
        .addOption('sun', t('settings.week.sun'))
        .setValue(s.weekStart)
        .onChange(async v => { s.weekStart = v === 'mon' ? 'mon' : v === 'sun' ? 'sun' : 'auto'; await save(); this.plugin.index.notify(); }));
    new Setting(el).setName(t('settings.days')).setDesc(t('settings.daysDesc'))
      .addSlider(x => x.setLimits(1, 14, 1).setValue(s.days).setDynamicTooltip().onChange(async v => { s.days = v; await save(); this.plugin.index.notify(); }));
  }
}
