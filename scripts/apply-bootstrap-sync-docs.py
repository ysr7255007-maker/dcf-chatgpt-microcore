from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def update(path, transform):
    target = ROOT / path
    text = target.read_text(encoding='utf-8')
    updated = transform(text)
    if updated == text:
        raise RuntimeError(f'no documentation change applied to {path}')
    target.write_text(updated, encoding='utf-8')


def current_state(text):
    text = text.replace('当前正式版本：`0.18.0`', '当前正式版本：`0.18.1`', 1)
    old = '`0.18.0` 将主要归因边界改为发送到本轮回复完成。'
    new = '`0.18.0` 将主要归因边界改为发送到本轮回复完成。`0.18.1` 修复 userscript 升级后能力包仍受旧 Catalog 节流影响的问题。'
    text = text.replace(old, new, 1)
    section = '''\n\n## 0.18.1 底座升级后的能力包自动同步\n\n- 用户现场确认：升级到 0.18.0 后，“问答轮次归因”按钮未出现；手动执行包管理“检查更新”后才出现，证明 bootstrap 与活动包 revision 之间存在升级闭环缺口。\n- 启动时先读取持久 root 中的旧 `kernel_version`。仅当它与当前 userscript `VERSION` 不同时，触发一次 bootstrap transition。\n- transition 会先把 userscript 内嵌的更新必需一方包 revision 安装并激活到权威 root，因此离线时也能获得与新底座配套的最低能力面。\n- 同一次启动强制检查 Catalog，绕过普通六小时节流，以获取可能晚于 userscript 构建时间发布的稳定包。\n- 旧 revision 保留不变；同一 bootstrap 版本内用户主动切换到旧 revision 后，刷新页面不会再次强制升级。\n- Runtime 暴露 `bootstrap.previous_kernel_version` 与 `bootstrap.changed`，用于确认本次启动是否执行了升级同步。\n'''
    if '## 0.18.1 底座升级后的能力包自动同步' not in text:
        text += section
    return text


def readme(text):
    text = text.replace('DCF `0.18.0` keeps a generic modular kernel', 'DCF `0.18.1` keeps a generic modular kernel', 1)
    section = '''\n\n## Bootstrap/package upgrade closure\n\nDCF `0.18.1` closes the gap between userscript upgrades and package activation. On a detected kernel-version transition, the bootstrap installs and activates newer embedded revisions of required first-party packages through the authoritative root, then performs an immediate Catalog check without the normal six-hour throttle. Previous revisions remain immutable and available, while same-version manual rollback choices survive later reloads.\n'''
    if '## Bootstrap/package upgrade closure' not in text:
        text += section
    return text


def maintenance(text):
    section = '''\n\n## 十五、底座升级与能力包同步\n\nuserscript 升级不能只更新 Host/Core 而继续沿用旧的 Catalog 节流状态。发布新的 bootstrap 时，必须验证首次启动会识别持久 `kernel_version` 变化，把更新的必需内嵌包 revision 通过权威 root 协调到 Runtime，并立即执行一次不受普通检查间隔限制的 Catalog 检查。\n\n同步只在真实 bootstrap transition 上发生；不得在每次刷新时把用户主动选择的旧 revision 强制改回。旧 revision 必须继续保持不可变并可恢复。验收至少同时检查：新底座无需手动“检查更新”即可出现对应功能、离线内嵌基线可用、远端 Catalog 仍能继续追新、同版本回退不会被刷新覆盖。\n'''
    if '## 十五、底座升级与能力包同步' not in text:
        text += section
    return text


update('docs/current-state.md', current_state)
update('README.md', readme)
update('docs/dcf-maintenance-skill.md', maintenance)
print('ok')
