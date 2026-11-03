import { App, normalizePath, PluginSettingTab, Setting, SettingDefinitionItem } from 'obsidian';
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

type Key = 'target' | 'inbox' | 'heading' | 'createdDate' | 'filterTag' | 'ignore' | 'doneDate' | 'nextBelow' | 'chips' | 'weekStart' | 'days';

export class DoableSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: DoablePlugin) {
    super(app, plugin);
  }

  /** Declared settings: the app draws the tab from these and finds them in its settings search. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const s = this.plugin.settings;
    return [
      {
        type: 'group', heading: t('settings.add'), items: [
          { name: t('settings.target'), desc: t('settings.targetDesc'), control: { type: 'dropdown', key: 'target', options: { inbox: t('settings.target.inbox'), daily: t('settings.target.daily') }, defaultValue: DEFAULTS.target } },
          { name: t('settings.inbox'), desc: t('settings.inboxDesc'), visible: () => s.target === 'inbox', control: { type: 'text', key: 'inbox', placeholder: 'Inbox.md', defaultValue: DEFAULTS.inbox } },
          { name: t('settings.heading'), desc: t('settings.headingDesc'), control: { type: 'text', key: 'heading', placeholder: 'Tasks' } },
          { name: t('settings.created'), control: { type: 'toggle', key: 'createdDate', defaultValue: DEFAULTS.createdDate } },
        ],
      },
      {
        type: 'group', heading: t('settings.tasks'), items: [
          { name: t('settings.filter'), desc: t('settings.filterDesc'), aliases: ['global filter'], control: { type: 'text', key: 'filterTag', placeholder: '#task' } },
          { name: t('settings.ignore'), desc: t('settings.ignoreDesc'), control: { type: 'textarea', key: 'ignore', placeholder: 'Templates\nArchive' } },
        ],
      },
      {
        type: 'group', heading: t('settings.completion'), items: [
          { name: t('settings.doneDate'), desc: t('settings.doneDateDesc'), control: { type: 'toggle', key: 'doneDate', defaultValue: DEFAULTS.doneDate } },
          { name: t('settings.nextBelow'), desc: t('settings.nextBelowDesc'), control: { type: 'toggle', key: 'nextBelow', defaultValue: DEFAULTS.nextBelow } },
        ],
      },
      {
        type: 'group', heading: t('settings.look'), items: [
          { name: t('settings.chips'), desc: t('settings.chipsDesc'), control: { type: 'toggle', key: 'chips', defaultValue: DEFAULTS.chips } },
          { name: t('settings.week'), control: { type: 'dropdown', key: 'weekStart', options: { auto: t('settings.week.auto'), mon: t('settings.week.mon'), sun: t('settings.week.sun') }, defaultValue: DEFAULTS.weekStart } },
          { name: t('settings.days'), desc: t('settings.daysDesc'), control: { type: 'slider', key: 'days', min: 1, max: 14, step: 1, defaultValue: DEFAULTS.days } },
        ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    const s = this.plugin.settings;
    if (key === 'ignore') return s.ignore.join('\n');
    return s[key as Key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    await this.apply(key as Key, value);
    if (key === 'target') this.update();
  }

  /** The one place a setting changes, for both ways of drawing the tab. */
  private async apply(key: Key, value: unknown): Promise<void> {
    const s = this.plugin.settings;
    const text = typeof value === 'string' ? value : '';
    let reindex = false;
    switch (key) {
      case 'target': s.target = value === 'daily' ? 'daily' : 'inbox'; break;
      case 'inbox': {
        const p = normalizePath(text.trim() || DEFAULTS.inbox);
        s.inbox = p.endsWith('.md') ? p : `${p}.md`;
        break;
      }
      case 'heading': s.heading = text.trim().replace(/^#+\s*/, ''); break;
      case 'filterTag': {
        const tag = text.trim();
        s.filterTag = tag && !tag.startsWith('#') ? `#${tag}` : tag;
        reindex = true;
        break;
      }
      case 'ignore':
        s.ignore = text.split('\n').map(l => l.trim().replace(/\/+$/, '')).filter(Boolean);
        reindex = true;
        break;
      case 'weekStart': s.weekStart = value === 'mon' ? 'mon' : value === 'sun' ? 'sun' : 'auto'; break;
      case 'days': s.days = typeof value === 'number' ? Math.min(14, Math.max(1, Math.round(value))) : DEFAULTS.days; break;
      default: s[key] = value === true;
    }
    await this.plugin.saveSettings();
    if (reindex) await this.plugin.index.rebuild();
    if (key === 'chips') this.plugin.refreshEditors();
    this.plugin.index.notify();
  }

  /** For apps before 1.13, which draw the tab themselves. */
  display(): void {
    const el = this.containerEl;
    el.empty();
    const s = this.plugin.settings;
    const set = (key: Key) => (v: unknown) => { void this.apply(key, v); };

    new Setting(el).setName(t('settings.add')).setHeading();
    new Setting(el).setName(t('settings.target')).setDesc(t('settings.targetDesc'))
      .addDropdown(d => d
        .addOption('inbox', t('settings.target.inbox'))
        .addOption('daily', t('settings.target.daily'))
        .setValue(s.target)
        .onChange(async v => { await this.apply('target', v); this.display(); }));
    if (s.target === 'inbox') {
      new Setting(el).setName(t('settings.inbox')).setDesc(t('settings.inboxDesc'))
        .addText(x => x.setPlaceholder('Inbox.md').setValue(s.inbox).onChange(set('inbox')));
    }
    new Setting(el).setName(t('settings.heading')).setDesc(t('settings.headingDesc'))
      .addText(x => x.setPlaceholder('Tasks').setValue(s.heading).onChange(set('heading')));
    new Setting(el).setName(t('settings.created'))
      .addToggle(x => x.setValue(s.createdDate).onChange(set('createdDate')));

    new Setting(el).setName(t('settings.tasks')).setHeading();
    new Setting(el).setName(t('settings.filter')).setDesc(t('settings.filterDesc'))
      .addText(x => x.setPlaceholder('#task').setValue(s.filterTag).onChange(set('filterTag')));
    new Setting(el).setName(t('settings.ignore')).setDesc(t('settings.ignoreDesc'))
      .addTextArea(x => x.setPlaceholder('Templates\nArchive').setValue(s.ignore.join('\n')).onChange(set('ignore')));

    new Setting(el).setName(t('settings.completion')).setHeading();
    new Setting(el).setName(t('settings.doneDate')).setDesc(t('settings.doneDateDesc'))
      .addToggle(x => x.setValue(s.doneDate).onChange(set('doneDate')));
    new Setting(el).setName(t('settings.nextBelow')).setDesc(t('settings.nextBelowDesc'))
      .addToggle(x => x.setValue(s.nextBelow).onChange(set('nextBelow')));

    new Setting(el).setName(t('settings.look')).setHeading();
    new Setting(el).setName(t('settings.chips')).setDesc(t('settings.chipsDesc'))
      .addToggle(x => x.setValue(s.chips).onChange(set('chips')));
    new Setting(el).setName(t('settings.week'))
      .addDropdown(d => d
        .addOption('auto', t('settings.week.auto'))
        .addOption('mon', t('settings.week.mon'))
        .addOption('sun', t('settings.week.sun'))
        .setValue(s.weekStart)
        .onChange(set('weekStart')));
    new Setting(el).setName(t('settings.days')).setDesc(t('settings.daysDesc'))
      .addSlider(x => x.setLimits(1, 14, 1).setValue(s.days).onChange(set('days')));
  }
}
