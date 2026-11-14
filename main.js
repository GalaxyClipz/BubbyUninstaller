const { app, BrowserWindow, ipcMain, shell, nativeImage } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { BLOAT, TWEAKS, WARN, KEEP_APPX, OPT_ORDER } = require('./lib/data');

let win;
let isAdmin = false;
const env = process.env;
const HOME = os.homedir();
const LOCAL = env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const ROAM = env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const WINDIR = env.SystemRoot || 'C:\\Windows';
const SYSDRIVE = (env.SystemDrive || 'C:').toUpperCase() + '\\';
const PF = env.ProgramFiles || 'C:\\Program Files';
const PF86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const PDATA = env.ProgramData || 'C:\\ProgramData';
const DAY = 864e5;

const log = (m) => win && win.webContents.send('log', m);
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- powershell ----------
function ps(script) {
  const full = "[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Continue';" + script;
  return new Promise((resolve) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', Buffer.from(full, 'utf16le').toString('base64')], { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}
async function psJson(script) {
  const r = await ps(script);
  try { const v = JSON.parse(r.out || '[]'); return Array.isArray(v) ? v : [v]; } catch { return []; }
}

// ---------- safety ----------
const PROTECTED = [HOME, LOCAL, ROAM, WINDIR, PF, PF86, PDATA, path.join(WINDIR, 'System32'),
  ...['desktop', 'documents', 'downloads', 'music', 'pictures', 'videos'].map((k) => app.getPath(k))]
  .map((p) => path.resolve(p).toLowerCase());
function safe(p) {
  const r = path.resolve(p).toLowerCase();
  if (r.length <= 3 || PROTECTED.includes(r)) return false;
  const w = path.resolve(WINDIR).toLowerCase();
  const OK_WIN = ['\\temp\\', '\\softwaredistribution\\download\\', '\\minidump\\', '\\livekernelreports\\', '\\logs\\cbs\\'];
  if (r.startsWith(w + '\\') && !OK_WIN.some((x) => r.startsWith(w + x)) && r !== w + '\\memory.dmp') return false;
  if (r.includes('\\windowsapps\\') || r.includes('\\system volume information')) return false;
  return true;
}
async function removePath(p, permanent = true) {
  if (!safe(p)) throw new Error('protected path');
  if (permanent) await fsp.rm(p, { recursive: true, force: true, maxRetries: 2 });
  else await shell.trashItem(p);
}

// ---------- drives ----------
async function drives() {
  const out = [];
  for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = L + ':\\';
    try { const s = await fsp.statfs(root); if (s.blocks) out.push({ root, free: s.bavail * s.bsize, total: s.blocks * s.bsize, system: root === SYSDRIVE }); } catch {}
  }
  return out;
}

// ---------- fs helpers ----------
const SKIP = new Set(['node_modules', '.git', 'appdata', '$recycle.bin', 'system volume information', '$windows.~bt', '$windows.~ws',
  'windows', 'program files', 'program files (x86)', 'programdata', 'windowsapps', 'steamlibrary', 'steamapps', 'steam', 'epic games',
  'xboxgames', 'riot games', 'battle.net', 'gog galaxy', 'ea games', 'ubisoft', 'origin games', 'recovery', 'msocache', 'perflogs']);
// live "scanned N files" counter for the loading screen
let scanned = 0, lastTick = 0;
function tick(n = 1) {
  scanned += n;
  const now = Date.now();
  if (now - lastTick > 120 && win && !win.isDestroyed()) { lastTick = now; win.webContents.send('progress', scanned); }
}
async function walk(roots, { exts, maxDepth = 10, cap = 60000 } = {}) {
  const out = new Map();
  let visited = 0;
  for (const root of roots) {
    const stack = [[root, 0]];
    while (stack.length && visited < 400000 && out.size < cap) {
      const [dir, depth] = stack.pop();
      let ents;
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
      tick(ents.length);
      for (const e of ents) {
        visited++;
        if (e.isSymbolicLink()) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (depth < maxDepth && !SKIP.has(e.name.toLowerCase()) && !e.name.startsWith('.')) stack.push([full, depth + 1]);
          continue;
        }
        if (exts && !exts.has(path.extname(e.name).slice(1).toLowerCase())) continue;
        const k = full.toLowerCase();
        if (out.has(k)) continue;
        try {
          const st = await fsp.stat(full);
          out.set(k, { path: full, name: e.name, size: st.size, mtime: st.mtimeMs, atime: st.atimeMs, folder: dir });
        } catch {}
      }
    }
  }
  return [...out.values()];
}
async function dirSize(dir) {
  let size = 0, count = 0;
  const stack = [dir];
  while (stack.length && count < 500000) {
    const d = stack.pop();
    let ents;
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    tick(ents.length);
    for (const e of ents) {
      const f = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) stack.push(f);
      else { try { size += (await fsp.stat(f)).size; count++; } catch {} }
    }
  }
  return { size, count };
}
async function sizeOf(p) { try { const s = await fsp.lstat(p); return s.isDirectory() ? (await dirSize(p)).size : s.size; } catch { return 0; } }
async function emptyDir(dir) {
  let freed = 0, failed = 0, ents;
  try { ents = await fsp.readdir(dir); } catch { return { freed, failed }; }
  for (const n of ents) {
    const f = path.join(dir, n);
    const size = await sizeOf(f);
    try { await removePath(f, true); freed += size; } catch { failed++; }
  }
  return { freed, failed };
}
async function globDirs(base, sub) {
  const res = [];
  try {
    for (const e of await fsp.readdir(base, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      for (const s of sub) { const p = path.join(base, e.name, s); if (fs.existsSync(p)) res.push(p); }
    }
  } catch {}
  return res;
}

// ---------- apps ----------
const UNINSTALL_KEYS = ['HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'];
function exeOf(cmd) {
  const m = /^\s*"([^"]+\.exe)"/i.exec(cmd || '') || /^\s*(.+?\.exe)\b/i.exec(cmd || '');
  return m ? m[1] : '';
}
async function listApps() {
  const rows = await psJson(`Get-ItemProperty ${UNINSTALL_KEYS.map(q).join(',')} -EA SilentlyContinue |
    ? { $_.DisplayName -and $_.UninstallString -and -not $_.SystemComponent -and -not $_.ParentKeyName -and $_.ReleaseType -notmatch 'Update|Hotfix' } |
    select DisplayName,DisplayVersion,Publisher,InstallLocation,UninstallString,QuietUninstallString,EstimatedSize,InstallDate,DisplayIcon,PSPath |
    ConvertTo-Json -Compress -Depth 2`);
  const seen = new Set();
  const apps = rows.filter((r) => { const k = r.DisplayName.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((r) => {
      const isMsi = /msiexec/i.test(r.UninstallString);
      const exe = isMsi ? '' : exeOf(r.UninstallString);
      const broken = !isMsi && !!exe && !fs.existsSync(exe);
      const silent = isMsi || !!r.QuietUninstallString || /unins\d{3}\.exe/i.test(exe);
      let icon = (r.DisplayIcon || '').split(',')[0].replace(/"/g, '');
      if (!icon || !fs.existsSync(icon)) icon = exe && fs.existsSync(exe) ? exe : '';
      return {
        kind: 'app', id: r.PSPath, title: r.DisplayName, version: r.DisplayVersion || '', publisher: r.Publisher || '',
        location: r.InstallLocation || '', uninstall: r.UninstallString, quiet: r.QuietUninstallString || '',
        size: (r.EstimatedSize || 0) * 1024, date: r.InstallDate || '', icon, broken, silent,
        warn: WARN.some((w) => w.test(r.DisplayName)),
      };
    });
  // Store apps the user installed
  const store = await psJson(`Get-AppxPackage | ? { -not $_.IsFramework -and -not $_.NonRemovable -and $_.SignatureKind -eq 'Store' } | % {
      $m = Get-AppxPackageManifest $_ -EA SilentlyContinue; if (!$m.Package.Applications.Application) { return }
      $p = $m.Package.Properties; $loc = $_.InstallLocation; $logo = ''
      if ($p.Logo -and $loc) { $l = Join-Path $loc $p.Logo; if (!(Test-Path $l)) { $d = Split-Path $l; $b = [IO.Path]::GetFileNameWithoutExtension($l); $l = (Get-ChildItem $d -Filter "$b*" -EA 0 | sort Length -Desc | select -First 1).FullName }; $logo = $l }
      [pscustomobject]@{ Name=$_.Name; Disp=$p.DisplayName; Pub=$p.PublisherDisplayName; Ver=$_.Version.ToString(); Logo=$logo; Loc=$loc; Date=$(try{(Get-Item $loc).CreationTime.ToString('yyyyMMdd')}catch{''}) } } | ConvertTo-Json -Compress`);
  for (const s of store) {
    if (KEEP_APPX.some((k) => k.test(s.Name))) continue;
    let title = s.Disp && !/^ms-resource/i.test(s.Disp) ? s.Disp : s.Name.split('.').pop().replace(/([a-z])([A-Z])/g, '$1 $2');
    if (seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    const gb = BLOAT.find((b) => b[4] && wild(b[0]).test(s.Name)); // Game Bar / Xbox app warning
    apps.push({ kind: 'app', store: true, id: 'appx:' + s.Name, pkg: s.Name, title, confirm: gb && gb[4], version: s.Ver, publisher: s.Pub && !/^ms-resource/i.test(s.Pub) ? s.Pub : '',
      location: s.Loc || '', size: 0, date: s.Date || '', logo: s.Logo ? pathToFileURL(s.Logo).href : '', silent: true, warn: false });
  }
  for (const a of apps.filter((a) => a.store && a.location)) a.size = (await dirSize(a.location)).size;
  return apps;
}
const norm = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/\bv?\d+(\.\d+)*\b/g, '')
  .replace(/\b(x64|x86|64-bit|32-bit|version)\b/g, '').replace(/[^a-z0-9]/g, '');
const GENERIC = new Set(['microsoft', 'microsoftcorporation', 'windows', 'commonfiles', 'intel', 'intelcorporation', 'packages',
  'programs', 'temp', 'google', 'nvidia', 'nvidiacorporation', 'amd', 'apple', 'mozilla', 'installer', 'package', 'cache', 'logs', 'steam', 'games']);

async function leftovers(a) {
  const nn = norm(a.title), np = norm(a.publisher);
  const found = new Map();
  const add = (p, sure, type = 'file', extra = {}) => {
    if (type === 'file' && !safe(p)) return;
    const k = type + p.toLowerCase();
    if (!found.has(k)) found.set(k, { type, path: p, sure, ...extra });
  };
  if (a.location && !a.store && fs.existsSync(a.location)) add(a.location, true);
  if (a.store) { // store app data
    for (const d of await fsp.readdir(path.join(LOCAL, 'Packages')).catch(() => [])) if (d.toLowerCase().startsWith(a.pkg.toLowerCase() + '_')) add(path.join(LOCAL, 'Packages', d), true);
  }
  if (nn.length < 3) return [...found.values()];
  const match = (d) => {
    const nd = norm(d);
    if (!nd || GENERIC.has(nd)) return 0;
    if (nd === nn) return 2;
    if ((nd.length >= 5 && nn.startsWith(nd)) || (nn.length >= 5 && nd.startsWith(nn))) return 1;
    return 0;
  };
  const bases = [PF, PF86, PDATA, ROAM, LOCAL, path.join(LOCAL, 'Programs'), path.join(HOME, 'Documents'), path.join(ROAM, '..', 'LocalLow'),
    path.join(PDATA, 'Microsoft\\Windows\\Start Menu\\Programs'), path.join(ROAM, 'Microsoft\\Windows\\Start Menu\\Programs'),
    path.join(HOME, 'Desktop'), path.join(env.PUBLIC || 'C:\\Users\\Public', 'Desktop')];
  for (const b of bases) {
    let ents; try { ents = await fsp.readdir(b, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const nameNoExt = e.isDirectory() ? e.name : e.name.replace(/\.(lnk|url)$/i, '');
      if (!e.isDirectory() && nameNoExt === e.name) continue; // only shortcuts as files
      const m = match(nameNoExt);
      if (m) add(path.join(b, e.name), m === 2);
      if (e.isDirectory() && np.length >= 3 && norm(e.name) === np && !GENERIC.has(np)) {
        try {
          const kids = await fsp.readdir(path.join(b, e.name), { withFileTypes: true });
          for (const c of kids) { const m2 = match(c.name); if (m2) add(path.join(b, e.name, c.name), m2 === 2); }
        } catch {}
      }
    }
  }
  for (const f of found.values()) f.size = await sizeOf(f.path);
  // registry keys, startup entries, scheduled tasks, services
  const keys = [];
  for (const hive of ['HKCU', 'HKLM']) for (const root of ['Software', 'Software\\WOW6432Node']) {
    if (a.publisher && !GENERIC.has(np)) keys.push(`${hive}:\\${root}\\${a.publisher}\\${a.title}`);
    keys.push(`${hive}:\\${root}\\${a.title}`);
  }
  const loc = (a.location || '').replace(/\\$/, '');
  const extra = await psJson(`$o = @()
    @(${keys.map(q).join(',')}${a.id && !a.store ? ',' + q(a.id) : ''}) | ? { Test-Path -LiteralPath $_ } | % { $o += [pscustomobject]@{t='reg';p=$_} }
    $rx = ${q(nn)}; $loc = ${q(loc.toLowerCase())}
    function N($s){ ($s -replace '\\(.*?\\)','' -replace '[^a-zA-Z0-9]','').ToLower() }
    foreach ($k in 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run') {
      $p = Get-ItemProperty $k -EA 0; if (!$p) { continue }
      $p.PSObject.Properties | ? { $_.Name -notlike 'PS*' } | % { $v = "$($_.Value)".ToLower(); if (((N $_.Name) -eq $rx) -or ($loc.Length -gt 6 -and $v.Contains($loc))) { $o += [pscustomobject]@{t='run';p=$k;n=$_.Name} } } }
    Get-ScheduledTask -EA 0 | ? { $_.TaskPath -notlike '\\Microsoft\\*' } | % { $n = N $_.TaskName; $x = "$($_.Actions.Execute)".ToLower()
      if (($rx.Length -ge 4 -and $n.StartsWith($rx)) -or ($loc.Length -gt 6 -and $x.Contains($loc))) { $o += [pscustomobject]@{t='task';p=$_.TaskPath;n=$_.TaskName} } }
    ${isAdmin ? `Get-CimInstance Win32_Service -EA 0 | ? { $loc.Length -gt 6 -and "$($_.PathName)".ToLower().Contains($loc) } | % { $o += [pscustomobject]@{t='svc';p=$_.Name;n=$_.DisplayName} }` : ''}
    $o | ConvertTo-Json -Compress`);
  for (const r of extra) {
    if (r.t === 'reg') add(r.p, true, 'reg');
    else if (r.t === 'run') add(`${r.p} → ${r.n}`, true, 'run', { key: r.p, name: r.n });
    else if (r.t === 'task') add(`${r.p}${r.n}`, true, 'task', { tpath: r.p, name: r.n });
    else if (r.t === 'svc') add(`Service: ${r.n}`, true, 'svc', { name: r.p });
  }
  return [...found.values()];
}

async function uninstallApp(a, opts = {}) {
  log(`▶ Uninstalling ${a.title}…`);
  if (a.store) {
    const r = await ps(`Get-AppxPackage -Name ${q(a.pkg)} | Remove-AppxPackage -EA Continue; if (Get-AppxPackage -Name ${q(a.pkg)}) {'LEFT'} else {'GONE'}`);
    log(r.out.endsWith('GONE') ? '  ✓ removed' : `  ✗ ${r.err.split('\n')[0]}`);
  } else if (a.broken) {
    log('  uninstaller is missing → force removing');
  } else {
    let cmd = a.quiet || a.uninstall;
    const m = /msiexec.*?(\{[0-9A-F-]{36}\})/i.exec(a.uninstall);
    if (m) cmd = `msiexec.exe /x ${m[1]} ${opts.silent ? '/qn' : '/qb'} /norestart`;
    else if (opts.silent && !a.quiet && /unins\d{3}\.exe/i.test(cmd)) cmd += ' /VERYSILENT /SUPPRESSMSGBOXES /NORESTART';
    else if (!opts.silent) cmd = a.uninstall;
    await new Promise((res) => { const p = spawn(cmd, { shell: true }); p.on('close', res); p.on('error', res); });
    for (let i = 0; i < 90; i++) { // some uninstallers fork and exit; wait for key to vanish
      if ((await ps(`Test-Path -LiteralPath ${q(a.id)}`)).out !== 'True') break;
      await wait(2000);
    }
  }
  const left = await leftovers(a);
  log(`  ✓ ${a.title} done. ${left.length} leftovers found.`);
  return left.map((l) => ({ ...l, app: a.title }));
}

async function deleteLeftovers(items) {
  const backup = path.join(app.getPath('userData'), 'registry-backups');
  await fsp.mkdir(backup, { recursive: true });
  let ok = 0, failed = 0, freed = 0;
  for (const it of items) {
    try {
      if (it.type === 'reg') {
        const regPath = it.path.replace(/^Microsoft\.PowerShell\.Core\\Registry::/i, '').replace(/^HKCU:/i, 'HKEY_CURRENT_USER').replace(/^HKLM:/i, 'HKEY_LOCAL_MACHINE');
        const file = path.join(backup, `${Date.now()}-${regPath.replace(/[^a-z0-9]+/gi, '_').slice(-80)}.reg`);
        await ps(`reg export ${q(regPath)} ${q(file)} /y | Out-Null; Remove-Item -LiteralPath ${q('Registry::' + regPath)} -Recurse -Force -EA Stop`);
        if ((await ps(`Test-Path -LiteralPath ${q('Registry::' + regPath)}`)).out === 'True') throw new Error('access denied');
      } else if (it.type === 'run') {
        const r = await ps(`Remove-ItemProperty -Path ${q(it.key)} -Name ${q(it.name)} -EA Stop`); if (r.code) throw new Error(r.err.split('\n')[0]);
      } else if (it.type === 'task') {
        const r = await ps(`Unregister-ScheduledTask -TaskPath ${q(it.tpath)} -TaskName ${q(it.name)} -Confirm:$false -EA Stop`); if (r.code) throw new Error(r.err.split('\n')[0]);
      } else if (it.type === 'svc') {
        const r = await ps(`Stop-Service ${q(it.name)} -Force -EA 0; sc.exe delete ${q(it.name)}`); if (r.code) throw new Error('could not delete service');
      } else { await removePath(it.path, true); freed += it.size || 0; }
      ok++; log(`  🗑 ${it.path}`);
    } catch (e) { failed++; log(`  ✗ ${it.path} (${e.message})`); }
  }
  return { ok, failed, freed };
}

// ---------- files ----------
const EXT = {
  videos: 'mp4 mkv mov avi wmv webm flv m4v mpg mpeg 3gp',
  pictures: 'jpg jpeg png gif webp heic bmp tif tiff',
  documents: 'pdf doc docx xls xlsx ppt pptx txt rtf odt ods csv md epub',
};
// below this = "tiny", goes in one bundle card instead of a swipe each
const MIN = { videos: 5e6, pictures: 300e3, documents: 100e3, downloads: 1e6, large: 500e6 };
function rootsFor(drive) {
  if (drive && drive.toUpperCase() !== SYSDRIVE) return null; // whole other drive
  const P = (k) => app.getPath(k);
  return { videos: [P('videos'), P('downloads'), P('desktop'), P('documents'), P('pictures')], pictures: [P('pictures'), P('downloads'), P('desktop'), P('documents')],
    documents: [P('documents'), P('downloads'), P('desktop')], downloads: [P('downloads')], large: [HOME], dupes: [P('documents'), P('downloads'), P('desktop'), P('pictures'), P('videos'), P('music')] };
}
const toCard = (cat) => (f) => ({ kind: 'file', cat, id: f.path, title: f.name, ...f, url: pathToFileURL(f.path).href });
async function scanFiles(cat, drive) {
  const r = rootsFor(drive);
  const roots = r ? r[cat] : [drive];
  const opts = cat === 'downloads' ? { maxDepth: 2 } : cat === 'large' ? { maxDepth: 14 } : { exts: new Set(EXT[cat].split(' ')) };
  const all = await walk(roots, opts);
  const big = all.filter((f) => f.size >= MIN[cat]).sort((a, b) => b.size - a.size).slice(0, 3000).map(toCard(cat));
  const tiny = cat === 'large' ? [] : all.filter((f) => f.size < MIN[cat]);
  if (tiny.length) {
    big.push({ kind: 'bundle', cat, id: 'bundle:' + cat, title: `${tiny.length.toLocaleString()} tiny ${cat === 'downloads' ? 'downloads' : cat}`,
      desc: `Everything under ${fmtB(MIN[cat])} rolled into one card so you don't swipe forever.`, size: tiny.reduce((a, b) => a + b.size, 0),
      count: tiny.length, paths: tiny.map((t) => t.path), sample: tiny.slice(0, 6).map((t) => t.name) });
  }
  return big;
}
const fmtB = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(0) + ' MB' : (b / 1e3).toFixed(0) + ' KB');

async function partHash(p, size) {
  const fd = await fsp.open(p, 'r');
  try {
    const h = crypto.createHash('md5');
    const n = Math.min(size, 1 << 20), buf = Buffer.alloc(n);
    await fd.read(buf, 0, n, 0); h.update(buf);
    if (size > n) { await fd.read(buf, 0, n, size - n); h.update(buf); if (size > 3 * n) { await fd.read(buf, 0, n, Math.floor(size / 2)); h.update(buf); } }
    return h.digest('hex');
  } finally { await fd.close(); }
}
async function scanDupes(drive) {
  const r = rootsFor(drive);
  const all = (await walk(r ? r.dupes : [drive], { maxDepth: 12 })).filter((f) => f.size >= 1e6);
  const bySize = new Map();
  for (const f of all) (bySize.get(f.size) || bySize.set(f.size, []).get(f.size)).push(f);
  const out = [];
  for (const group of bySize.values()) {
    if (group.length < 2) continue;
    const byHash = new Map();
    for (const f of group) { try { const h = await partHash(f.path, f.size); (byHash.get(h) || byHash.set(h, []).get(h)).push(f); } catch {} }
    for (const g of byHash.values()) {
      if (g.length < 2) continue;
      g.sort((a, b) => a.mtime - b.mtime || a.path.length - b.path.length); // oldest = original
      for (const c of g.slice(1)) out.push({ ...toCard('dupes')(c), original: g[0].path });
    }
  }
  return out.sort((a, b) => b.size - a.size);
}

const BCACHE = ['Cache', 'Code Cache', 'GPUCache', 'Service Worker\\CacheStorage', 'Service Worker\\ScriptCache'];
// Squirrel apps keep app-1.0.1, app-1.0.2 ... next to each other. Return all but the newest.
async function oldVersions(apps) {
  const res = [];
  for (const a of apps) {
    const base = path.join(LOCAL, a);
    let ents; try { ents = await fsp.readdir(base, { withFileTypes: true }); } catch { continue; }
    const vers = ents.filter((e) => e.isDirectory() && /^app-\d/.test(e.name)).map((e) => e.name)
      .sort((x, y) => y.slice(4).localeCompare(x.slice(4), undefined, { numeric: true }));
    res.push(...vers.slice(1).map((v) => path.join(base, v)));
  }
  return res;
}
async function scanJunk() {
  const DL = app.getPath('downloads');
  const old = (await walk([DL], { maxDepth: 1 })).filter((f) => Date.now() - f.mtime > 30 * DAY);
  const groups = [
    { id: 'usertemp', title: 'Your temp files', desc: 'Leftovers apps forgot to clean up.', dirs: [os.tmpdir()] },
    { id: 'wintemp', title: 'Windows temp files', desc: 'System temp folder.', dirs: [path.join(WINDIR, 'Temp')], admin: true },
    { id: 'installers', title: 'Old installers in Downloads', desc: 'Setup files (.exe .msi .zip) older than 30 days. Apps are already installed.', files: old.filter((f) => /\.(exe|msi|msix|appx|zip|7z|rar|iso)$/i.test(f.name)) },
    { id: 'tinydl', title: 'Old tiny downloads', desc: 'Small files (<1 MB) sitting in Downloads for 30+ days.', files: old.filter((f) => f.size < 1e6 && !/\.(exe|msi|zip|7z|rar)$/i.test(f.name)) },
    { id: 'crash', title: 'Crash dumps & error reports', desc: 'Crash logs, memory dumps and blue-screen reports nobody reads.',
      dirs: [path.join(LOCAL, 'CrashDumps'), path.join(LOCAL, 'Microsoft\\Windows\\WER'), path.join(PDATA, 'Microsoft\\Windows\\WER'),
        path.join(WINDIR, 'Minidump'), path.join(WINDIR, 'LiveKernelReports')],
      files: [path.join(WINDIR, 'MEMORY.DMP')] },
    { id: 'browser', title: 'Browser cache', desc: 'Chrome, Edge, Brave, Opera, Firefox cache. You stay logged in.', dirs: [
      ...(await globDirs(path.join(LOCAL, 'Google\\Chrome\\User Data'), BCACHE)),
      ...(await globDirs(path.join(LOCAL, 'Microsoft\\Edge\\User Data'), BCACHE)),
      ...(await globDirs(path.join(LOCAL, 'BraveSoftware\\Brave-Browser\\User Data'), BCACHE)),
      ...(await globDirs(path.join(LOCAL, 'Mozilla\\Firefox\\Profiles'), ['cache2'])),
      path.join(LOCAL, 'Opera Software\\Opera GX Stable\\Cache'), path.join(LOCAL, 'Opera Software\\Opera Stable\\Cache'),
      path.join(LOCAL, 'Microsoft\\Windows\\INetCache')] },
    { id: 'oldver', title: 'Old app versions', desc: 'Discord, Slack, GitHub Desktop keep every old version after updating. Newest one stays.',
      dirs: [...(await oldVersions(['Discord', 'DiscordPTB', 'DiscordCanary', 'slack', 'GitHubDesktop', 'Postman'])), path.join(LOCAL, 'Discord\\packages')] },
    { id: 'drivers', title: 'Old driver installers', desc: 'NVIDIA / AMD / Intel setup files left after driver installs. Often GBs.',
      dirs: [SYSDRIVE + 'NVIDIA', SYSDRIVE + 'AMD', path.join(PDATA, 'NVIDIA Corporation\\Downloader'), path.join(PDATA, 'AMD\\PPC')] },
    { id: 'dev', title: 'Developer caches', desc: 'npm, pip, yarn, NuGet, Go, Electron download caches. They re-download when needed.',
      dirs: [path.join(LOCAL, 'npm-cache'), path.join(ROAM, 'npm-cache'), path.join(LOCAL, 'pip\\cache'), path.join(LOCAL, 'Yarn\\Cache'),
        path.join(LOCAL, 'NuGet\\v3-cache'), path.join(LOCAL, 'NuGet\\plugins-cache'), path.join(LOCAL, 'go-build'),
        path.join(LOCAL, 'electron\\Cache'), path.join(LOCAL, 'electron-builder\\Cache'), path.join(LOCAL, 'ms-playwright-go')] },
    { id: 'steam', title: 'Steam leftovers', desc: 'Steam web cache, crash dumps, logs and shader cache. Games and saves untouched.',
      dirs: ['appcache\\httpcache', 'dumps', 'logs', 'steamapps\\shadercache', 'steamapps\\temp'].map((d) => path.join(PF86, 'Steam', d)) },
    { id: 'cbs', title: 'Windows setup logs', desc: 'Component servicing logs. Can grow to GBs.', admin: true, dirs: [path.join(WINDIR, 'Logs\\CBS')] },
    { id: 'apps', title: 'App caches', desc: 'Discord, Spotify, Teams, Steam web, Epic web, VS Code cache.', dirs: [
      path.join(ROAM, 'discord\\Cache'), path.join(ROAM, 'discord\\Code Cache'), path.join(ROAM, 'discord\\GPUCache'), path.join(LOCAL, 'Spotify\\Data'),
      path.join(ROAM, 'Microsoft\\Teams\\Cache'), path.join(LOCAL, 'Steam\\htmlcache'), path.join(LOCAL, 'EpicGamesLauncher\\Saved\\webcache'),
      path.join(ROAM, 'Code\\Cache'), path.join(ROAM, 'Code\\CachedData')] },
    { id: 'shader', title: 'Shader cache', desc: 'GPU shader cache. Games rebuild it (first launch a bit slower).', dirs: [
      path.join(LOCAL, 'D3DSCache'), path.join(LOCAL, 'NVIDIA\\DXCache'), path.join(LOCAL, 'NVIDIA\\GLCache'), path.join(LOCAL, 'AMD\\DxCache')] },
    { id: 'logs', title: 'Old log files', desc: 'App logs in AppData older than 14 days.', files: (await walk([LOCAL, ROAM], { exts: new Set(['log', 'etl', 'dmp']), maxDepth: 5 })).filter((f) => Date.now() - f.mtime > 14 * DAY) },
    { id: 'wupdate', title: 'Windows Update downloads', desc: 'Update files Windows already installed. Safe to wipe.', dirs: [path.join(WINDIR, 'SoftwareDistribution\\Download')], admin: true,
      pre: 'Stop-Service wuauserv,bits -Force -EA 0', post: 'Start-Service wuauserv,bits -EA 0' },
    { id: 'deliveryopt', title: 'Update sharing cache', desc: 'Delivery Optimization cache of Windows updates.', admin: true, count: 1,
      dirs: [path.join(WINDIR, 'ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization\\Cache')],
      ps: 'Delete-DeliveryOptimizationCache -Force -EA 0' },
    { id: 'winsxs', title: 'Old Windows Update versions', desc: 'Superseded update parts in WinSxS (DISM cleanup). Often frees several GB. Takes 5-15 min.', admin: true, count: 1, unknown: true,
      ps: 'Dism.exe /Online /Cleanup-Image /StartComponentCleanup /Quiet /NoRestart | Out-Null' },
    { id: 'winold', title: 'Old Windows install (Windows.old)', desc: 'Your previous Windows version after a big update. You lose the "go back" option.', admin: true,
      dirs: [SYSDRIVE + 'Windows.old', SYSDRIVE + '$WINDOWS.~BT', SYSDRIVE + '$WINDOWS.~WS'],
      ps: `foreach($d in '${SYSDRIVE}Windows.old','${SYSDRIVE}$WINDOWS.~BT','${SYSDRIVE}$WINDOWS.~WS'){ if(Test-Path $d){ takeown /F $d /R /A /D Y | Out-Null; icacls $d /grant '*S-1-5-32-544:F' /T /C /Q | Out-Null; cmd /c rd /s /q "$d" } }` },
  ];
  const out = [];
  JUNK.clear();
  for (const g of groups) {
    let size = 0, count = g.count || 0;
    if (g.files) {
      const files = [];
      for (const f of g.files) {
        if (typeof f !== 'string') { files.push(f); continue; }
        try { const st = await fsp.stat(f); files.push({ path: f, name: path.basename(f), size: st.size }); } catch {}
      }
      size += files.reduce((a, b) => a + b.size, 0); count += files.length;
      g.paths = files.map((f) => f.path); if (!g.dirs) g.sample = files.slice(0, 6).map((f) => f.name);
      delete g.files;
    }
    if (g.dirs) {
      g.dirs = g.dirs.filter((d) => fs.existsSync(d));
      if (g.id === 'winold' && !g.dirs.length) continue;
      for (const d of g.dirs) { const s = await dirSize(d); size += s.size; count += s.count; }
    }
    if (g.id === 'deliveryopt' && !size) continue;
    if (!g.ps && !size) continue; // nothing worth a card
    if (count) { JUNK.set(g.id, g); out.push({ kind: 'junk', id: g.id, title: g.title, desc: g.desc, admin: g.admin, unknown: g.unknown, sample: g.sample, size, count }); }
  }
  const rb = await psJson(`$i=(New-Object -ComObject Shell.Application).NameSpace(10).Items(); @{c=$i.Count; s=($i | Measure-Object -Property Size -Sum).Sum} | ConvertTo-Json -Compress`);
  if (rb[0] && rb[0].c) { JUNK.set('recycle', { id: 'recycle' }); out.push({ kind: 'junk', id: 'recycle', title: 'Recycle Bin', desc: 'Stuff you already deleted. Gone for good after this.', size: rb[0].s || 0, count: rb[0].c }); }
  return out.sort((a, b) => b.size - a.size);
}
const JUNK = new Map(); // id -> group def (main side only, renderer just sends id)
async function cleanJunk({ id, size: known = 0 }) {
  const g = JUNK.get(id);
  if (!g) throw new Error('scan again first');
  if (g.id === 'recycle') { await ps('Clear-RecycleBin -Force -EA SilentlyContinue'); return { freed: known, failed: 0 }; }
  if (g.admin && !isAdmin && (g.ps || g.pre)) { log('  ✗ needs admin'); return { freed: 0, failed: 1 }; }
  const free0 = (await drives()).find((d) => d.system)?.free || 0;
  let freed = 0, failed = 0;
  if (g.pre) await ps(g.pre);
  if (g.ps) await ps(g.ps);
  else {
    for (const d of g.dirs || []) { const r = await emptyDir(d); freed += r.freed; failed += r.failed; }
    for (const p of g.paths || []) { const s = await sizeOf(p); try { await removePath(p, true); freed += s; } catch { failed++; } }
  }
  if (g.post) await ps(g.post);
  if (g.ps) freed = Math.max(0, ((await drives()).find((d) => d.system)?.free || 0) - free0); // measure real space won
  return { freed, failed };
}

// ---------- bloat ----------
const wild = (p) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
async function listBloat() {
  const pk = await psJson(`Get-AppxPackage ${isAdmin ? '-AllUsers' : ''} | ? { -not $_.IsFramework -and -not $_.NonRemovable } | select Name,Version | ConvertTo-Json -Compress`);
  const out = new Map();
  for (const p of pk) {
    const b = BLOAT.find(([pat]) => wild(pat).test(p.Name));
    if (b && !out.has(p.Name)) out.set(p.Name, { kind: 'bloat', id: p.Name, title: b[1], desc: b[2], risk: b[3], confirm: b[4], version: p.Version, pkg: p.Name });
  }
  return [...out.values()];
}
async function removeBloat(b) {
  log(`▶ Removing ${b.title}…`);
  const all = isAdmin ? '-AllUsers' : '';
  const r = await ps(`Get-AppxPackage -Name ${q(b.pkg)} ${all} | Remove-AppxPackage ${all} -EA Continue
    ${isAdmin ? `Get-AppxProvisionedPackage -Online | ? DisplayName -eq ${q(b.pkg)} | Remove-AppxProvisionedPackage -Online -EA SilentlyContinue | Out-Null` : ''}
    if (Get-AppxPackage -Name ${q(b.pkg)}) { 'LEFT' } else { 'GONE' }`);
  const ok = r.out.endsWith('GONE');
  log(ok ? `  ✓ ${b.title} gone` : `  ✗ ${b.title} failed ${r.err.split('\n')[0] || ''}`);
  return ok;
}

// ---------- tweaks ----------
const regVal = (v) => (typeof v === 'number' || /^0x[0-9a-f]+$/i.test(v) ? [v, 'DWord'] : [q(v), 'String']);
const regSet = ([p, n, v]) => { const [val, type] = regVal(v); return `if(!(Test-Path ${q(p)})){New-Item ${q(p)} -Force|Out-Null}; New-ItemProperty -Path ${q(p)} -Name ${q(n)} -Value ${val} -PropertyType ${type} -Force|Out-Null`; };
const regDel = ([p, n]) => `Remove-ItemProperty -Path ${q(p)} -Name ${q(n)} -EA SilentlyContinue`;
const regChk = ([p, n, v]) => `((Get-ItemProperty -Path ${q(p)} -Name ${q(n)} -EA SilentlyContinue).${q(n)} -eq ${regVal(v)[0]})`;
async function listTweaks(group) {
  const rank = (t) => { const i = OPT_ORDER.indexOf(t.id); return i < 0 ? 99 : i; };
  const list = TWEAKS.filter((t) => t.group === group).sort((a, b) => rank(a) - rank(b));
  const checks = list.map((t) => `${q(t.id)}=[bool](${t.check || (t.reg.length ? t.reg.map(regChk).join(' -and ') : '$false')})`).join('; ');
  const st = (await psJson(`[pscustomobject]@{ ${checks} } | ConvertTo-Json -Compress`))[0] || {};
  return list.map((t) => ({ kind: 'tweak', group: t.group, id: t.id, title: t.title, desc: t.desc, admin: t.admin, tag: t.tag, warn: t.warn, confirm: t.confirm, applied: !!st[t.id], noUndo: !!t.noUndo }));
}
async function applyTweak(id, undo) {
  const t = TWEAKS.find((x) => x.id === id);
  if (t.admin && !isAdmin) { log(`  ✗ ${t.title} needs admin`); return false; }
  log(`▶ ${undo ? 'Undo' : 'Apply'}: ${t.title}`);
  const s = undo ? [...(t.undo ? t.undo.map(regSet) : t.reg.map(regDel)), t.undoPs || ''] : [...t.reg.map(regSet), t.ps || ''];
  const r = await ps(s.join('\n'));
  log(r.code === 0 ? '  ✓ done' : `  ✗ ${r.err.split('\n')[0]}`);
  return r.code === 0;
}

// ---------- startup apps (same on/off switch Task Manager uses, fully undoable) ----------
const SA = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved';
async function listStartup() {
  const rows = await psJson(`$o=@()
    function St($hive,$sub,$name){ $v=(Get-ItemProperty "$($hive):\\${SA}\\$sub" -Name $name -EA 0).$name; if($v -and ($v[0] % 2) -eq 1){'off'}else{'on'} }
    foreach($h in 'HKCU','HKLM'){ foreach($k in 'Run','Run32'){ $path = if($k -eq 'Run32'){"$($h):\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run"}else{"$($h):\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"}
      $p=Get-ItemProperty $path -EA 0; if(!$p){continue}
      $p.PSObject.Properties | ? { $_.Name -notlike 'PS*' } | % { $o += [pscustomobject]@{hive=$h;sub=$k;name=$_.Name;cmd="$($_.Value)";state=(St $h $k $_.Name)} } } }
    foreach($d in @(@('HKCU',[Environment]::GetFolderPath('Startup')),@('HKLM',[Environment]::GetFolderPath('CommonStartup')))){
      Get-ChildItem $d[1] -File -EA 0 | ? Name -ne 'desktop.ini' | % { $o += [pscustomobject]@{hive=$d[0];sub='StartupFolder';name=$_.Name;cmd=$_.FullName;state=(St $d[0] 'StartupFolder' $_.Name)} } }
    $o | ConvertTo-Json -Compress`);
  return rows.filter((r) => r.state === 'on').map((r) => {
    const exe = exeOf(r.cmd) || (r.cmd.match(/^[^ ]+\.exe/i) || [''])[0];
    return { kind: 'startup', id: `${r.hive}:${r.sub}:${r.name}`, title: r.name.replace(/\.lnk$/i, ''), desc: r.cmd, icon: exe && fs.existsSync(exe) ? exe : r.cmd,
      hive: r.hive, sub: r.sub, name: r.name, admin: r.hive === 'HKLM' };
  });
}
async function setStartup(it, on) {
  if (it.admin && !isAdmin) { log(`  ✗ ${it.title} needs admin`); return false; }
  log(`▶ ${on ? 'Enable' : 'Disable'} startup: ${it.title}`);
  const bytes = on ? '2,0,0,0,0,0,0,0,0,0,0,0' : '3,0,0,0,0,0,0,0,0,0,0,0';
  const k = `${it.hive}:\\${SA}\\${it.sub}`;
  const r = await ps(`if(!(Test-Path ${q(k)})){New-Item ${q(k)} -Force|Out-Null}; New-ItemProperty -Path ${q(k)} -Name ${q(it.name)} -Value ([byte[]](${bytes})) -PropertyType Binary -Force | Out-Null`);
  log(r.code === 0 ? '  ✓ done' : `  ✗ ${r.err.split('\n')[0]}`);
  return r.code === 0;
}

// ---------- ipc ----------
const h = (name, fn) => ipcMain.handle(name, async (_e, ...a) => { try { return await fn(...a); } catch (e) { log(`✗ ${e.message}`); throw e; } });
h('info', async () => ({ isAdmin, user: os.userInfo().username, drives: await drives(), sysDrive: SYSDRIVE }));
h('scan', async (cat, drive) => {
  scanned = 0;
  if (cat === 'apps') return listApps();
  if (cat === 'bloat') return listBloat();
  if (cat === 'tweaks') return listTweaks('debloat');
  if (cat === 'opt') return listTweaks('opt');
  if (cat === 'startup') return listStartup();
  if (cat === 'junk') return scanJunk();
  if (cat === 'dupes') return scanDupes(drive);
  return scanFiles(cat, drive);
});
h('icon', async (p) => { if (!p || !fs.existsSync(p)) return null; try { const i = await app.getFileIcon(p, { size: 'large' }); return i.isEmpty() ? null : i.toDataURL(); } catch { return null; } });
h('uninstall', uninstallApp);
h('deleteLeftovers', deleteLeftovers);
h('deleteFiles', async (items, permanent = true) => {
  let ok = 0, failed = 0, freed = 0;
  for (const it of items) {
    for (const p of it.paths || [it.path]) {
      const size = it.paths ? await sizeOf(p) : it.size || 0;
      try { await removePath(p, permanent); ok++; freed += size; if (!it.paths) log(`  🗑 ${p}`); } catch (e) { failed++; log(`  ✗ ${p} (${e.message})`); }
    }
    if (it.paths) log(`  🗑 ${it.title}`);
  }
  return { ok, failed, freed };
});
h('cleanJunk', async (g) => { log(`▶ Cleaning ${g.title}…`); const r = await cleanJunk(g); log(`  ✓ freed ${fmtB(r.freed)}${r.failed ? `, ${r.failed} in use (skipped)` : ''}`); return r; });
h('removeBloat', removeBloat);
h('setStartup', setStartup);
h('tweak', applyTweak);
h('restorePoint', async () => {
  if (!isAdmin) return { ok: false };
  log('▶ Making restore point…');
  const r = await ps(`Enable-ComputerRestore -Drive "$env:SystemDrive\\" -EA SilentlyContinue
    New-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SystemRestore' -Name SystemRestorePointCreationFrequency -Value 0 -PropertyType DWord -Force | Out-Null
    Checkpoint-Computer -Description 'BubbyUninstaller' -RestorePointType MODIFY_SETTINGS -EA Stop; 'OK'`);
  const ok = r.out.endsWith('OK');
  log(ok ? '  ✓ restore point made' : `  ✗ restore point failed: ${r.err.split('\n')[0]}`);
  return { ok };
});
h('restartExplorer', () => ps('Stop-Process -Name explorer -Force; Start-Sleep 1; if(!(Get-Process explorer -EA SilentlyContinue)){Start-Process explorer}'));
h('reveal', (p) => shell.showItemInFolder(p));
h('open', (p) => shell.openPath(p));
h('github', () => shell.openExternal('https://github.com/GalaxyClipz/BubbyUninstaller'));
h('elevate', async () => {
  const args = process.defaultApp ? [path.resolve(process.argv[1] || '.')] : [];
  await ps(`Start-Process -FilePath ${q(process.execPath)} ${args.length ? `-ArgumentList ${args.map((a) => q('"' + a + '"')).join(',')}` : ''} -WorkingDirectory ${q(app.getAppPath())} -Verb RunAs`);
  app.quit();
});

// ---------- dev helpers ----------
async function devFlags() {
  const argv = process.argv;
  if (argv.includes('--selftest')) { // read-only, deletes nothing
    const t = Date.now();
    const apps = await listApps();
    const pick = apps.find((a) => a.store) || apps[0];
    const files = await scanFiles('pictures', SYSDRIVE);
    const r = { admin: isAdmin, apps: apps.length, store: apps.filter((a) => a.store).map((a) => a.title), broken: apps.filter((a) => a.broken).map((a) => a.title),
      silent: apps.filter((a) => a.silent).length, sample: pick && pick.title, leftovers: pick ? (await leftovers(pick)).map((l) => `${l.type}:${l.path}`) : [],
      drives: (await drives()).map((d) => d.root), pictures: files.length, bundle: (files.find((f) => f.kind === 'bundle') || {}).title,
      dupes: (await scanDupes(SYSDRIVE)).length, opt: (await listTweaks('opt')).map((x) => `${x.id}:${x.applied}`),
      debloat: (await listTweaks('debloat')).filter((x) => x.applied).length, startup: (await listStartup()).map((s) => s.title), junk: (await scanJunk()).map((j) => `${j.title} ${fmtB(j.size)}`), ms: Date.now() - t };
    process.stdout.write(JSON.stringify(r, null, 1) + '\n');
    return true;
  }
  if (argv.includes('--make-icon')) { // renders src/logo.svg -> build/icon.png
    const w = new BrowserWindow({ width: 256, height: 256, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
    await w.loadFile(path.join(__dirname, 'src', 'logo.svg'));
    await wait(500);
    await fsp.mkdir(path.join(__dirname, 'build'), { recursive: true });
    await fsp.writeFile(path.join(__dirname, 'build', 'icon.png'), (await w.webContents.capturePage()).toPNG());
    return true;
  }
  return false;
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.whenReady().then(async () => {
  isAdmin = (await ps("([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrators')")).out === 'True';
  if (await devFlags()) return app.quit();
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1000, minHeight: 640, backgroundColor: '#07080c', show: false,
    title: 'BubbyUninstaller', titleBarStyle: 'hidden', icon: fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined,
    titleBarOverlay: { color: '#07080c', symbolColor: '#c9d2e3', height: 40 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  const si = process.argv.indexOf('--shot'); // dev: --shot <dir> saves screenshots
  if (si > 0) {
    const dir = process.argv[si + 1];
    const snap = async (n) => fsp.writeFile(path.join(dir, n), (await win.webContents.capturePage()).toPNG());
    const js = (c) => win.webContents.executeJavaScript(`try { (()=>{ ${c} })() } catch (e) { console.error(e) }; 0`).catch(() => {}); // never wait on page promises
    setTimeout(() => app.quit(), 120000); // safety net
    win.webContents.once('did-finish-load', async () => {
      await wait(1500); await snap('tip.png'); await js("document.querySelector('#tipok')?.click()"); await wait(300); await snap('home.png');
      // nothing below runs a real action: only swipes + screens, never the Go button
      js("openDeck('junk')"); await wait(700); await snap('loading.png'); await wait(12000); await snap('deck-junk.png');
      await js("openDeck('opt')"); await wait(4000); await js("swipe('right')"); await wait(400); await js("swipe('left')"); await wait(400);
      await js("const t=document.querySelector('#deck').lastElementChild; t.style.transform='translateX(80px) rotate(5deg)'; t.dataset.glow='good'; t.querySelector('.stamp.r').style.opacity=.9"); await wait(300); await snap('deck-opt.png');
      await js("const c=S.all.find(x=>x.confirm); if(c){ S.queue=S.queue.filter(x=>x!==c); S.queue.unshift(c); renderCards(); swipe('right'); }"); await wait(600); await snap('modal.png');
      await js("document.querySelector('#m-no').click()"); await wait(200);
      await js("openDeck('smart')"); await wait(3000); await js("swipe('left')"); await wait(400); await js("swipe('left')"); await wait(400);
      for (let i = 0; i < 12; i++) { await js("S.queue[0] && S.queue[0].kind==='tweak' ? swipe('left') : swipe('right')"); await wait(300); }
      await snap('deck-smart.png');
      await js("review()"); await wait(500); await snap('review.png');
      await js("openDeck('videos')"); await wait(6000); await snap('deck-videos.png');
      app.quit();
    });
  }
});
app.on('window-all-closed', () => app.quit());
