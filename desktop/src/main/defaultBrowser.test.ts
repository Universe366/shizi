import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isDefaultProtocolClient: vi.fn(() => false),
    setAsDefaultProtocolClient: vi.fn(() => true),
    getAppPath: vi.fn(() => 'C:\\app')
  },
  shell: { openExternal: vi.fn(async () => undefined) }
}));

import {
  BROWSER_PROG_ID,
  browserCommandLine,
  browserRegistrationPlan,
  defaultAppsSettingsUri,
  friendlyBrowserName,
  parseRegFileDefaultValue,
  parseRegValue,
  setDefaultBrowser,
  windowsCleanupLegacyKeys,
  windowsDefaultBrowserStatus,
  windowsRegisterBrowser,
  type CommandRunner
} from './defaultBrowser';

const EXE = 'C:\\Program Files\\拾字\\拾字.exe';

function userChoiceKey(protocol: string): string {
  return `HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${protocol}\\UserChoice`;
}

function registeredKey(): string {
  return 'HKCU\\Software\\RegisteredApplications';
}

function regLine(name: string, data: string): string {
  return `    ${name}    REG_SZ    ${data}`;
}

/** 生成 reg export 文件内容（UTF-16 写出，键名行不影响解析）。 */
function regExportFile(command: string): string {
  const escaped = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return [
    'Windows Registry Editor Version 5.00',
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\http]',
    `@="${escaped}"`,
    ''
  ].join('\r\n');
}

/** 写/删一律成功；查询按键返回预置输出，export 把预置内容写成 .reg 文件。 */
function fakeRunner(
  output: Map<string, string>,
  calls: string[][] = [],
  exports: Map<string, string> = new Map()
): CommandRunner {
  return async (_file, args) => {
    calls.push(args);
    if (args[0] === 'export') {
      const content = exports.get(args[1]);
      if (content === undefined) throw new Error('REG: key not found');
      fs.writeFileSync(args[2], content, 'utf16le');
      return { stdout: '', stderr: '' };
    }
    if (args[0] !== 'query') return { stdout: '', stderr: '' };
    const value = output.get(args[1]);
    if (value === undefined) throw new Error('REG: key not found');
    return { stdout: value, stderr: '' };
  };
}

describe('friendlyBrowserName', () => {
  it('认识常见浏览器 ProgId', () => {
    expect(friendlyBrowserName('MSEdgeHTM')).toBe('Microsoft Edge');
    expect(friendlyBrowserName('ChromeHTML')).toBe('Google Chrome');
    expect(friendlyBrowserName('FirefoxURL-308046B0AF4A39CB')).toBe('Mozilla Firefox');
    expect(friendlyBrowserName('BraveHTML')).toBe('Brave');
  });

  it('把拾字自己的 ProgId 显示成中文名', () => {
    expect(friendlyBrowserName(BROWSER_PROG_ID)).toBe('拾字');
  });

  it('未知 ProgId 原样返回，空值返回空串', () => {
    expect(friendlyBrowserName('SomeProgId')).toBe('SomeProgId');
    expect(friendlyBrowserName('')).toBe('');
  });
});

describe('命令行与注册表计划', () => {
  it('打开链接时带上 %1，包路径为空时不带入口脚本', () => {
    expect(browserCommandLine(EXE)).toBe(`"${EXE}" "%1"`);
    expect(browserCommandLine('C:\\e\\electron.exe', 'C:\\app')).toBe(
      `"C:\\e\\electron.exe" "C:\\app" "%1"`
    );
  });

  it('登记 http/https 到同一 ProgId，并写入 RegisteredApplications', () => {
    const plan = browserRegistrationPlan(EXE);
    const associations = plan.filter((item) => item.key.endsWith('\\URLAssociations'));
    expect(associations.map((item) => [item.value, item.data])).toEqual([
      ['http', BROWSER_PROG_ID],
      ['https', BROWSER_PROG_ID]
    ]);

    const registered = plan.find((item) => item.key === registeredKey());
    expect(registered?.value).toBe('Shizi');
    expect(registered?.data).toBe('Software\\Clients\\StartMenuInternet\\Shizi\\Capabilities');

    const command = plan.find((item) => item.key.endsWith('\\shell\\open\\command'));
    expect(command?.data).toContain('%1');
  });

  it('ProgId 带 URL Protocol 标记，否则系统不认它是链接处理程序', () => {
    const plan = browserRegistrationPlan(EXE);
    expect(plan.some((item) => item.value === 'URL Protocol')).toBe(true);
  });
});

describe('reg 输出解析', () => {
  it('按值名读取 ProgId', () => {
    const output = `HKEY_CURRENT_USER\\...\\UserChoice\r\n${regLine('ProgId', 'MSEdgeHTM')}\r\n`;
    expect(parseRegValue(output, 'ProgId')).toBe('MSEdgeHTM');
  });

  it('reg export 的默认值能还原中文路径与 %1', () => {
    const file = regExportFile(`"${EXE}" "%1"`);
    expect(parseRegFileDefaultValue(file)).toBe(`"${EXE}" "%1"`);
    expect(parseRegFileDefaultValue('Windows Registry Editor Version 5.00\r\n')).toBe('');
  });
});

describe('windowsDefaultBrowserStatus', () => {
  it('UserChoice 都是拾字时判定为默认', async () => {
    const output = new Map<string, string>([
      [userChoiceKey('http'), regLine('ProgId', BROWSER_PROG_ID)],
      [userChoiceKey('https'), regLine('ProgId', BROWSER_PROG_ID)],
      [registeredKey(), regLine('Shizi', 'Software\\Clients\\StartMenuInternet\\Shizi\\Capabilities')]
    ]);
    const status = await windowsDefaultBrowserStatus(fakeRunner(output));
    expect(status).toMatchObject({
      platform: 'win32',
      isDefault: true,
      registered: true,
      currentDefault: '拾字',
      currentProgId: BROWSER_PROG_ID,
      canAutoSet: false
    });
  });

  it('系统默认是 Edge 时如实显示，不冒充已设置', async () => {
    const output = new Map<string, string>([
      [userChoiceKey('http'), regLine('ProgId', 'MSEdgeHTM')],
      [userChoiceKey('https'), regLine('ProgId', 'MSEdgeHTM')],
      [registeredKey(), regLine('Shizi', 'Software\\Clients\\StartMenuInternet\\Shizi\\Capabilities')]
    ]);
    const status = await windowsDefaultBrowserStatus(fakeRunner(output));
    expect(status.isDefault).toBe(false);
    expect(status.currentDefault).toBe('Microsoft Edge');
    expect(status.registered).toBe(true);
  });

  it('读不到注册表时按未设置、未登记处理', async () => {
    const status = await windowsDefaultBrowserStatus(fakeRunner(new Map()));
    expect(status.isDefault).toBe(false);
    expect(status.registered).toBe(false);
    expect(status.currentDefault).toBe('');
  });
});

describe('windowsRegisterBrowser', () => {
  it('写入全部注册项，并清掉指向本程序的旧协议键', async () => {
    const calls: string[][] = [];
    const legacyKey = 'HKCU\\Software\\Classes\\http';
    const exported = new Map<string, string>([
      [legacyKey, regExportFile(`"${EXE}" "%1"`)]
    ]);
    const ok = await windowsRegisterBrowser(fakeRunner(new Map(), calls, exported), EXE);

    expect(ok).toBe(true);
    const adds = calls.filter((args) => args[0] === 'add');
    expect(adds).toHaveLength(browserRegistrationPlan(EXE).length);
    expect(adds).toContainEqual([
      'add',
      'HKCU\\Software\\RegisteredApplications',
      '/v',
      'Shizi',
      '/t',
      'REG_SZ',
      '/d',
      'Software\\Clients\\StartMenuInternet\\Shizi\\Capabilities',
      '/f'
    ]);
    expect(calls).toContainEqual(['delete', legacyKey, '/f']);
  });
});

describe('windowsCleanupLegacyKeys', () => {
  it('只删确实指向本程序的键', async () => {
    const calls: string[][] = [];
    const exported = new Map<string, string>([
      ['HKCU\\Software\\Classes\\http', regExportFile(`"${EXE}" "%1"`)],
      ['HKCU\\Software\\Classes\\https', regExportFile('"C:\\Other\\other.exe" "%1"')]
    ]);
    await windowsCleanupLegacyKeys(fakeRunner(new Map(), calls, exported), EXE);
    expect(calls.filter((args) => args[0] === 'delete')).toEqual([
      ['delete', 'HKCU\\Software\\Classes\\http', '/f']
    ]);
  });
});

describe('defaultAppsSettingsUri', () => {
  it('Win11 跳到拾字自己的默认应用页，Win10 打开总页面', () => {
    expect(defaultAppsSettingsUri(22631)).toBe(
      'ms-settings:defaultapps?registeredAppUser=Shizi'
    );
    expect(defaultAppsSettingsUri(19045)).toBe('ms-settings:defaultapps');
  });
});

describe('setDefaultBrowser', () => {
  it('先登记再打开设置，并把结果回报给界面', async () => {
    const openSettings = vi.fn(async () => true);
    const result = await setDefaultBrowser({
      run: fakeRunner(new Map()),
      exePath: EXE,
      openSettings
    });
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ registered: true, settingsOpened: true });
  });
});
