import { useEffect, useRef, useState } from 'react';
import { SettingsPanel } from './components/SettingsPanel';
import { SETTINGS_GROUPS } from './components/settings/registry';

/** 设置页：左侧分类导航 + 右侧分组内容。 */
export function SettingsPage({ onClose }: { onClose: () => void }) {
  // 默认打开「外观」：这是历史默认页，避免升级后第一眼变成代理设置。
  const [group, setGroup] = useState(
    () => SETTINGS_GROUPS.find((item) => item.id === 'appearance')?.id || SETTINGS_GROUPS[0].id
  );
  const [dirty, setDirty] = useState(false);
  const [toc, setToc] = useState<Array<{ title: string }>>([]);
  const [activeToc, setActiveToc] = useState(0);
  const tocSections = useRef<HTMLElement[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const active = SETTINGS_GROUPS.find((item) => item.id === group) || SETTINGS_GROUPS[0];
  const Icon = active.icon;

  const close = () => {
    if (dirty && !window.confirm('有未保存的设置，确定关闭？')) return;
    onClose();
  };

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [group]);

  const jumpToSection = (title: string, index: number) => {
    setActiveToc(index);
    const host = contentRef.current;
    if (!host) return;
    const section = Array.from(
      host.querySelectorAll<HTMLElement>('.settings-section')
    ).find(
      (item) =>
        (item.querySelector('.settings-section-name')?.textContent || '').trim() === title
    );
    if (!section) return;
    (section as HTMLDetailsElement).open = true;
    const sticky = host.querySelector<HTMLElement>('.settings-sticky');
    const offset = (sticky?.getBoundingClientRect().height || 0) + 10;
    const top =
      section.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop - offset;
    host.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };

  useEffect(() => {
    const host = contentRef.current;
    if (!host) return;
    const visibleSections = () =>
      Array.from(host.querySelectorAll<HTMLElement>('.settings-section')).filter(
        (section) => section.style.display !== 'none'
      );
    const collect = () => {
      const sections = visibleSections();
      tocSections.current = sections;
      setToc(
        sections.map((section) => ({
          title: (section.querySelector('.settings-section-name')?.textContent || '').trim()
        }))
      );
    };
    collect();
    const observer = new MutationObserver(collect);
    observer.observe(host, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style']
    });
    const onScroll = () => {
      const sections = visibleSections();
      const sticky = host.querySelector<HTMLElement>('.settings-sticky');
      const top = host.getBoundingClientRect().top + (sticky?.getBoundingClientRect().height || 0) + 28;
      let active = 0;
      sections.forEach((section, index) => {
        if (section.getBoundingClientRect().top <= top) active = index;
      });
      setActiveToc(active);
    };
    host.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      observer.disconnect();
      host.removeEventListener('scroll', onScroll);
    };
  }, [group]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (dirty && !window.confirm('有未保存的设置，确定关闭？')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, onClose]);

  return (
    <div className="settings-page">
      <header className="settings-page-head">
        <div className="settings-page-title">
          <Icon size={16} />
          <div>
            <div className="settings-page-name">{active.label}</div>
            <div className="settings-page-desc">{active.description}</div>
          </div>
        </div>
        <div className="settings-page-head-actions">
          {dirty && <span className="settings-dirty">未保存</span>}
          <button className="mini-btn" onClick={close}>
            关闭
          </button>
        </div>
      </header>

      <div className="settings-page-body">
        <nav className="settings-nav">
          {SETTINGS_GROUPS.map((item) => {
            const ItemIcon = item.icon;
            return (
              <button
                key={item.id}
                className={`settings-nav-item${group === item.id ? ' is-active' : ''}`}
                title={item.description}
                onClick={() => setGroup(item.id)}
              >
                <ItemIcon size={14} />
                <span className="settings-nav-text">
                  <span className="settings-nav-label">{item.label}</span>
                  <span className="settings-nav-desc">{item.description}</span>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="settings-page-content" ref={contentRef}>
          <SettingsPanel group={group} onDirtyChange={setDirty} />
        </div>
        {toc.length > 2 && (
          <aside className="settings-toc" aria-label="本页目录">
            <div className="settings-toc-title">本页目录</div>
            {toc.map((item, index) => (
              <button
                key={`${item.title}-${index}`}
                className={`settings-toc-item${activeToc === index ? ' is-active' : ''}`}
                title={item.title}
                onClick={() => jumpToSection(item.title, index)}
              >
                {item.title}
              </button>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}
