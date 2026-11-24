// 默认浏览器注册与状态（Windows）。
//
// Windows 10/11 不允许程序直接改写默认浏览器：真正的默认项在
// HKCU\...\UrlAssociations\http\UserChoice 里，且带哈希保护。Chrome / Edge 的做法是：
//   1. 把应用登记到「默认应用」列表（StartMenuInternet + Capabilities + RegisteredApplications）；
//   2. 打开系统设置，让用户自己点「设为默认」；
//   3. 读 UserChoice 判断自己是不是默认，而不是读自己写的键。
//
// 旧实现只调 setAsDefaultProtocolClient('http')，会写 HKCU\Software\Classes\http，
// 既改不了系统默认（UserChoice 优先），又让 isDefaultProtocolClient 误报为 true。
// 这里全部走 reg.exe（HKCU，无需管理员），并把纯逻辑导出便于单测。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { app, shell } from 'electron';
import type { DefaultBrowserStatus } from '../shared/types';

const execFileAsync = promisify(execFile);

export const BROWSER_PROG_ID = 'ShiziHTML';
export const BROWSER_REG_NAME = 'Shizi';
export const BROWSER_DISPLAY_NAME = '拾字';
export const BROWSER_DESCRIPTION = '拾字 · B 站字幕与 AI 笔记';

const CLASSES_KEY = `HKCU\\Software\\Classes\\${BROWSER_PROG_ID}`;
const INTERNET_KEY = `HKCU\\Software\\Clients\\StartMenuInternet\\${BROWSER_REG_NAME}`;
const CAPABILITIES_KEY = `${INTERNET_KEY}\\Capabilities`;
const REGISTERED_APPS_KEY = 'HKCU\\Software\\RegisteredApplications';
const USER_CHOICE_KEY = (protocol: string) =>
  `HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${protocol}\\UserChoice`;

/** 执行一条外部命令；测试里替换成假实现，避免真的写注册表。 */
export type CommandRunner = (
  file: string,
  args: string[]
) => Promise<{ stdout: string; stderr: string }>;

const runCommand: CommandRunner = async (file, args) => {
  const result = (await execFileAsync(file, args, {
    timeout: 5000,
    windowsHide: true
  })) as unknown as { stdout?: string | Buffer; stderr?: string | Buffer };
  return {
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? '')
  };
};

export interface RegCommand {
  key: string;
  /** 省略表示写默认值（/ve） */
  value?: string;
  data: string;
}

/** 从 reg query 输出里取某个值（输出是本地化文本，只认 REG_* 类型后的内容）。 */
export function parseRegValue(output: string, valueName: string): string {
  const escaped = valueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = output.match(
    new RegExp(`^\\s*${escaped}\\s+REG_[A-Z_]+\\s+(.*)$`, 'im')
  );
  return match ? match[1].trim() : '';
}

/**
 * 解析 `reg export` 文件里的默认值。
 * 导出是 UTF-16，中文路径不会像 `reg query` 那样被控制台代码页读成乱码。
 */
export function parseRegFileDefaultValue(text: string): string {
  const line = text.split(/\r?\n/).find((item) => item.trimStart().startsWith('@='));
  if (!line) return '';
  let value = line.trim().slice(2).trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  // .reg 里反斜杠和引号都是转义的。
  return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

let exportSeq = 0;

/** 读某个键的默认值；键不存在或导出失败时返回空串。 */
async function readKeyDefaultValue(key: string, run: CommandRunner): Promise<string> {
  const file = path.join(
    os.tmpdir(),
    `shizi-reg-${process.pid}-${Date.now()}-${exportSeq++}.reg`
  );
  try {
    await run('reg.exe', ['export', key, file, '/y']);
    return parseRegFileDefaultValue(fs.readFileSync(file, 'utf16le'));
  } catch {
    return '';
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      // 导出失败时本来就没有临时文件。
    }
  }
}

const KNOWN_BROWSERS: Array<[string, string]> = [
  ['MSEdge', 'Microsoft Edge'],
  ['Chrome', 'Google Chrome'],
  ['Firefox', 'Mozilla Firefox'],
  ['Brave', 'Brave'],
  ['Vivaldi', 'Vivaldi'],
  ['Opera', 'Opera'],
  ['Shizi', BROWSER_DISPLAY_NAME],
  ['QQBrowser', 'QQ 浏览器'],
  ['Sogou', '搜狗高速浏览器'],
  ['360', '360 浏览器']
];

/** ProgId → 给人看的浏览器名；未知时原样返回 ProgId。 */
export function friendlyBrowserName(progId: string): string {
  const value = (progId || '').trim();
  if (!value) return '';
  for (const [prefix, name] of KNOWN_BROWSERS) {
    if (value.toLowerCase().startsWith(prefix.toLowerCase())) return name;
  }
  return value;
}

/** 打开链接时实际执行的命令行；开发模式下要把入口脚本带上。 */
export function browserCommandLine(exePath: string, appPath?: string): string {
  const parts = appPath ? [exePath, appPath, '%1'] : [exePath, '%1'];
  return parts.map((part) => `"${part}"`).join(' ');
}

/** 应用自身的启动命令行（默认应用列表里的「打开」入口）。 */
export function browserOpenCommand(exePath: string, appPath?: string): string {
  const parts = appPath ? [exePath, appPath] : [exePath];
  return parts.map((part) => `"${part}"`).join(' ');
}

/** 登记到「默认应用」所需写入的全部键值（按 Chrome 的布局）。 */
export function browserRegistrationPlan(exePath: string, appPath?: string): RegCommand[] {
  const icon = `"${exePath}",0`;
  const open = browserOpenCommand(exePath, appPath);
  return [
    { key: CLASSES_KEY, data: `${BROWSER_DISPLAY_NAME} 文档` },
    { key: CLASSES_KEY, value: 'URL Protocol', data: '' },
    { key: CLASSES_KEY, value: 'FriendlyTypeName', data: `${BROWSER_DISPLAY_NAME} 文档` },
    { key: `${CLASSES_KEY}\\Application`, value: 'ApplicationName', data: BROWSER_DISPLAY_NAME },
    { key: `${CLASSES_KEY}\\DefaultIcon`, data: icon },
    { key: `${CLASSES_KEY}\\shell\\open\\command`, data: browserCommandLine(exePath, appPath) },
    { key: INTERNET_KEY, data: BROWSER_DISPLAY_NAME },
    { key: `${INTERNET_KEY}\\DefaultIcon`, data: icon },
    { key: `${INTERNET_KEY}\\shell\\open\\command`, data: open },
    { key: CAPABILITIES_KEY, value: 'ApplicationName', data: BROWSER_DISPLAY_NAME },
    { key: CAPABILITIES_KEY, value: 'ApplicationDescription', data: BROWSER_DESCRIPTION },
    { key: CAPABILITIES_KEY, value: 'ApplicationIcon', data: icon },
    { key: `${CAPABILITIES_KEY}\\URLAssociations`, value: 'http', data: BROWSER_PROG_ID },
    { key: `${CAPABILITIES_KEY}\\URLAssociations`, value: 'https', data: BROWSER_PROG_ID },
    {
      key: REGISTERED_APPS_KEY,
      value: BROWSER_REG_NAME,
      data: `Software\\Clients\\StartMenuInternet\\${BROWSER_REG_NAME}\\Capabilities`
    }
  ];
}

function regAddArgs(command: RegCommand): string[] {
  return [
    'add',
    command.key,
    ...(command.value ? ['/v', command.value] : ['/ve']),
    '/t',
    'REG_SZ',
    '/d',
    command.data,
    '/f'
  ];
}

function windowsBuild(): number {
  const build = Number(os.release().split('.')[2] || 0);
  return Number.isFinite(build) ? build : 0;
}

/** Win11 可直接跳到本应用的默认应用页；Win10 只能打开总页面。 */
export function defaultAppsSettingsUri(build = windowsBuild()): string {
  return build >= 22000
    ? `ms-settings:defaultapps?registeredAppUser=${encodeURIComponent(BROWSER_REG_NAME)}`
    : 'ms-settings:defaultapps';
}

async function readUserChoice(protocol: string, run: CommandRunner): Promise<string> {
  try {
    const { stdout } = await run('reg.exe', ['query', USER_CHOICE_KEY(protocol), '/v', 'ProgId']);
    return parseRegValue(stdout, 'ProgId');
  } catch {
    return '';
  }
}

async function isRegistered(run: CommandRunner): Promise<boolean> {
  try {
    const { stdout } = await run('reg.exe', [
      'query',
      REGISTERED_APPS_KEY,
      '/v',
      BROWSER_REG_NAME
    ]);
    return parseRegValue(stdout, BROWSER_REG_NAME).length > 0;
  } catch {
    return false;
  }
}

/** Windows 分支：读 UserChoice 判断真实默认项，并看是否已登记。 */
export async function windowsDefaultBrowserStatus(
  run: CommandRunner = runCommand
): Promise<DefaultBrowserStatus> {
  const [httpProgId, httpsProgId, registered] = await Promise.all([
    readUserChoice('http', run),
    readUserChoice('https', run),
    isRegistered(run)
  ]);
  return {
    platform: 'win32',
    isDefault: httpProgId === BROWSER_PROG_ID && httpsProgId === BROWSER_PROG_ID,
    registered,
    currentDefault: friendlyBrowserName(httpProgId),
    currentProgId: httpProgId,
    canAutoSet: false
  };
}

export async function getDefaultBrowserStatus(
  run: CommandRunner = runCommand
): Promise<DefaultBrowserStatus> {
  if (process.platform !== 'win32') {
    const isDefault = app.isDefaultProtocolClient('http');
    return {
      platform: process.platform,
      isDefault,
      registered: isDefault,
      currentDefault: '',
      currentProgId: '',
      canAutoSet: false
    };
  }
  return windowsDefaultBrowserStatus(run);
}

/** 旧版按钮写过 HKCU\Software\Classes\http；只在确实指向本程序时清掉。 */
export async function windowsCleanupLegacyKeys(
  run: CommandRunner,
  exePath: string
): Promise<void> {
  const needle = exePath.toLowerCase();
  for (const protocol of ['http', 'https']) {
    const key = `HKCU\\Software\\Classes\\${protocol}`;
    const command = await readKeyDefaultValue(key, run);
    if (!command.toLowerCase().includes(needle)) continue;
    try {
      await run('reg.exe', ['delete', key, '/f']);
    } catch {
      // 删不掉就留着：不影响新逻辑，状态已经改读 UserChoice。
    }
  }
}

export async function cleanupLegacyProtocolKeys(
  run: CommandRunner = runCommand,
  exePath = process.execPath
): Promise<void> {
  if (process.platform !== 'win32') return;
  return windowsCleanupLegacyKeys(run, exePath);
}

export interface RegisterOptions {
  run?: CommandRunner;
  exePath?: string;
  appPath?: string;
}

/** Windows 分支：写入「默认应用」登记；返回是否全部成功。 */
export async function windowsRegisterBrowser(
  run: CommandRunner,
  exePath: string,
  appPath?: string
): Promise<boolean> {
  await windowsCleanupLegacyKeys(run, exePath);

  let ok = true;
  for (const command of browserRegistrationPlan(exePath, appPath)) {
    try {
      await run('reg.exe', regAddArgs(command));
    } catch {
      ok = false;
    }
  }
  return ok;
}

/** 把应用登记进「默认应用」列表；返回是否全部写入成功。 */
export async function registerBrowser(options: RegisterOptions = {}): Promise<boolean> {
  if (process.platform !== 'win32') {
    const http = app.setAsDefaultProtocolClient('http');
    const https = app.setAsDefaultProtocolClient('https');
    return http && https;
  }
  const run = options.run ?? runCommand;
  const exePath = options.exePath ?? process.execPath;
  const appPath = options.appPath ?? (process.defaultApp ? app.getAppPath() : undefined);
  return windowsRegisterBrowser(run, exePath, appPath);
}

/** 打开系统「默认应用」设置：Win11 跳转到拾字自己的页面。 */
export async function openDefaultAppsSettings(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  try {
    await shell.openExternal(defaultAppsSettingsUri());
    return true;
  } catch {
    return false;
  }
}

/** 一键设置：先登记，再打开系统设置让用户点选。 */
export async function setDefaultBrowser(
  options: RegisterOptions & { openSettings?: () => Promise<boolean> } = {}
): Promise<{ registered: boolean; settingsOpened: boolean }> {
  const registered = await registerBrowser(options);
  const settingsOpened = await (options.openSettings ?? openDefaultAppsSettings)();
  return { registered, settingsOpened };
}
