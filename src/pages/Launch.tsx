import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  BellRing,
  BriefcaseBusiness,
  Check,
  Cloud,
  FileText,
  FolderKanban,
  Globe2,
  ListTodo,
  LockKeyhole,
  Menu,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import './Launch.css';

const capabilities = [
  {
    index: '01',
    title: '项目进度',
    description: '从材料收集到落地归档，以统一阶段视图掌握项目所处位置、负责人和关键期限。',
    icon: FolderKanban,
    tone: 'blue',
    detail: '全生命周期推进',
  },
  {
    index: '02',
    title: '管理周报',
    description: '按历史周连续沉淀业务进展，自动承接上周内容，让团队更新聚焦真正发生的变化。',
    icon: FileText,
    tone: 'cyan',
    detail: '周度信息沉淀',
  },
  {
    index: '03',
    title: '任务中心',
    description: '将项目行动项落实到人，通过待办、邮件与消息提醒推动每个事项按时闭环。',
    icon: ListTodo,
    tone: 'amber',
    detail: '责任到人闭环',
  },
  {
    index: '04',
    title: '业务工作台',
    description: '把分散的数据转化为清晰的业务视图，快速识别进度、规模、趋势与团队负荷。',
    icon: BarChart3,
    tone: 'green',
    detail: '实时经营洞察',
  },
];

const flowSteps = [
  { label: '建立项目', meta: '统一录入', icon: BriefcaseBusiness },
  { label: '推进阶段', meta: '过程透明', icon: Zap },
  { label: '周度更新', meta: '持续沉淀', icon: FileText },
  { label: '任务闭环', meta: '责任到人', icon: Check },
];

const projectRows = [
  { name: '跨境债券策略 110 号', owner: '周文杰', stage: '材料收集', color: '#4e8df5', progress: 43 },
  { name: '美元多资产配置 005 号', owner: '陈敏 / 吴佳宁', stage: '报告撰写', color: '#23b6b2', progress: 62 },
  { name: '境外固收 3 号', owner: '张志远', stage: '上会中', color: '#f0a11a', progress: 78 },
];

export default function Launch() {
  const isAuthenticated = useAuthStore(state => state.isAuthenticated);
  const [menuOpen, setMenuOpen] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'GCO Link｜国际业务协作平台';

    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-launch-reveal]'));
    const observer = new IntersectionObserver(
      entries => entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add('is-visible');
      }),
      { threshold: 0.14 },
    );
    items.forEach(item => observer.observe(item));

    return () => {
      observer.disconnect();
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    const progress = progressRef.current;
    const update = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 0;
      progress?.style.setProperty('--launch-progress', `${ratio}`);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const hero = heroRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !hero || !context) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let animationFrame = 0;
    let width = 0;
    let height = 0;
    const pointer = { x: -1000, y: -1000 };
    const nodes = Array.from({ length: reducedMotion ? 28 : 72 }, (_, index) => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.00012,
      vy: (Math.random() - 0.5) * 0.00012,
      radius: index % 9 === 0 ? 2.4 : 1.3,
      red: index % 7 === 0,
    }));

    const resize = () => {
      const rect = hero.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = hero.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
    };
    const onPointerLeave = () => { pointer.x = -1000; pointer.y = -1000; };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      nodes.forEach(node => {
        if (!reducedMotion) {
          node.x += node.vx;
          node.y += node.vy;
          if (node.x < 0 || node.x > 1) node.vx *= -1;
          if (node.y < 0 || node.y > 1) node.vy *= -1;
        }
        const x = node.x * width;
        const y = node.y * height;
        const distance = Math.hypot(x - pointer.x, y - pointer.y);
        const glow = Math.max(0, 1 - distance / 220);
        context.beginPath();
        context.arc(x, y, node.radius + glow * 1.8, 0, Math.PI * 2);
        context.fillStyle = node.red
          ? `rgba(190, 18, 60, ${0.2 + glow * 0.55})`
          : `rgba(29, 78, 216, ${0.18 + glow * 0.58})`;
        context.fill();
      });

      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          const ax = a.x * width;
          const ay = a.y * height;
          const bx = b.x * width;
          const by = b.y * height;
          const distance = Math.hypot(ax - bx, ay - by);
          if (distance > 115) continue;
          context.beginPath();
          context.moveTo(ax, ay);
          context.lineTo(bx, by);
          context.strokeStyle = `rgba(55, 91, 164, ${(1 - distance / 115) * 0.09})`;
          context.lineWidth = 0.7;
          context.stroke();
        }
      }
      if (!reducedMotion) animationFrame = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener('resize', resize);
    hero.addEventListener('pointermove', onPointerMove);
    hero.addEventListener('pointerleave', onPointerLeave);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', resize);
      hero.removeEventListener('pointermove', onPointerMove);
      hero.removeEventListener('pointerleave', onPointerLeave);
    };
  }, []);

  const handleHeroPointer = (event: MouseEvent<HTMLElement>) => {
    const rect = heroRef.current?.getBoundingClientRect();
    if (!rect || !heroRef.current) return;
    heroRef.current.style.setProperty('--pointer-x', `${event.clientX - rect.left}px`);
    heroRef.current.style.setProperty('--pointer-y', `${event.clientY - rect.top}px`);
    const tiltX = ((event.clientY - rect.top) / rect.height - 0.5) * -5;
    const tiltY = ((event.clientX - rect.left) / rect.width - 0.5) * 7;
    heroRef.current.style.setProperty('--tilt-x', `${tiltX}deg`);
    heroRef.current.style.setProperty('--tilt-y', `${tiltY}deg`);
  };

  const appHref = isAuthenticated ? '/dashboard' : '/login';

  return (
    <div className="launch-page">
      <div ref={progressRef} className="launch-scroll-progress" aria-hidden="true"><i /></div>
      <nav className="launch-nav" aria-label="宣传页导航">
        <a className="launch-brand" href="#top" aria-label="GCO Link 首页">
          <span className="launch-brand-mark"><img src="/lianheng-mark.png" alt="联衡信托" /></span>
          <span className="launch-brand-copy">
            <strong>GCO Link</strong>
            <small>联衡信托 · 国际业务协作平台</small>
          </span>
        </a>

        <div className={`launch-nav-links ${menuOpen ? 'is-open' : ''}`}>
          <a href="#capabilities" onClick={() => setMenuOpen(false)}>核心能力</a>
          <a href="#workflow" onClick={() => setMenuOpen(false)}>业务流程</a>
          <a href="#security" onClick={() => setMenuOpen(false)}>安全与连接</a>
          <Link className="launch-nav-cta" to={appHref} onClick={() => setMenuOpen(false)}>
            进入系统 <ArrowRight size={15} />
          </Link>
        </div>

        <button
          type="button"
          className="launch-menu-button"
          onClick={() => setMenuOpen(open => !open)}
          aria-label={menuOpen ? '关闭导航菜单' : '打开导航菜单'}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      <main>
        <section
          id="top"
          ref={heroRef}
          className="launch-hero"
          onMouseMove={handleHeroPointer}
        >
          <canvas ref={canvasRef} className="launch-particle-canvas" aria-hidden="true" />
          <div className="launch-grid" aria-hidden="true" />
          <div className="launch-color-ribbon" aria-hidden="true"><i /><b /></div>
          <div className="launch-orb launch-orb-one" aria-hidden="true" />
          <div className="launch-orb launch-orb-two" aria-hidden="true" />
          <div className="launch-hero-inner">
            <div className="launch-hero-copy" data-launch-reveal>
              <div className="launch-kicker">
                <span className="launch-kicker-dot" />
                GCO LINK · GLOBAL CAPITAL OPERATIONS
              </div>
              <h1>
                <span className="launch-title-line launch-title-line-one">让国际业务的</span>
                <span className="launch-title-line launch-title-line-two"><em>每一步</em>，都有迹可循</span>
              </h1>
              <p>
                从项目推进、管理周报到任务协同与资料归档，GCO Link 将分散的信息连接成一条清晰、实时、可追踪的业务链路。
              </p>
              <div className="launch-hero-actions">
                <Link className="launch-button launch-button-primary" to={appHref}>
                  {isAuthenticated ? '返回工作台' : '进入 GCO Link'}
                  <ArrowRight size={17} />
                </Link>
                <a className="launch-button launch-button-ghost" href="#capabilities">
                  浏览核心能力
                </a>
              </div>
              <div className="launch-trust-row">
                <span><ShieldCheck size={16} /> 权限隔离</span>
                <span><Zap size={16} /> 实时保存</span>
                <span><Cloud size={16} /> 云端协作</span>
              </div>
            </div>

            <div className="launch-product-stage" data-launch-reveal>
              <div className="launch-stage-label launch-stage-label-project">PROJECT</div>
              <div className="launch-stage-label launch-stage-label-weekly">WEEKLY</div>
              <div className="launch-stage-label launch-stage-label-data">DATA</div>
              <div className="launch-stage-glow" aria-hidden="true" />
              <div className="launch-dashboard-card">
                <div className="launch-dashboard-topbar">
                  <div>
                    <small>业务驾驶舱</small>
                    <strong>今日业务概览</strong>
                  </div>
                  <div className="launch-live-pill"><span /> LIVE</div>
                </div>

                <div className="launch-dashboard-metrics">
                  <div><small>推进中</small><strong>20</strong><span>个项目</span></div>
                  <div><small>本周更新</small><strong>32</strong><span>项记录</span></div>
                  <div><small>待处理</small><strong>08</strong><span>个事项</span></div>
                </div>

                <div className="launch-chart-panel">
                  <div className="launch-chart-head">
                    <span>项目推进趋势</span>
                    <small>近 6 个月</small>
                  </div>
                  <div className="launch-chart" aria-label="项目推进趋势示意图">
                    <div className="launch-chart-gridlines" />
                    <svg viewBox="0 0 520 150" role="img" aria-hidden="true">
                      <defs>
                        <linearGradient id="launch-area" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#4b8dff" stopOpacity="0.34" />
                          <stop offset="100%" stopColor="#4b8dff" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <path className="launch-chart-area" d="M8 130 L8 106 L105 88 L202 102 L299 53 L396 70 L512 22 L512 130 Z" />
                      <path className="launch-chart-line" d="M8 106 L105 88 L202 102 L299 53 L396 70 L512 22" />
                      {[['8','106'], ['105','88'], ['202','102'], ['299','53'], ['396','70'], ['512','22']].map(([cx, cy]) => (
                        <circle key={`${cx}-${cy}`} className="launch-chart-point" cx={cx} cy={cy} r="4" />
                      ))}
                    </svg>
                  </div>
                </div>

                <div className="launch-project-list">
                  {projectRows.map((project, index) => (
                    <div className="launch-project-row" key={project.name} style={{ '--row-delay': `${index * 140}ms` } as React.CSSProperties}>
                      <span className="launch-project-status" style={{ background: project.color }} />
                      <div className="launch-project-name"><strong>{project.name}</strong><small>{project.owner}</small></div>
                      <span className="launch-project-stage">{project.stage}</span>
                      <div className="launch-project-progress"><i style={{ width: `${project.progress}%` }} /></div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="launch-float-card launch-float-card-top">
                <BellRing size={17} />
                <span><strong>任务已同步</strong><small>负责人已收到提醒</small></span>
              </div>
              <div className="launch-float-card launch-float-card-bottom">
                <Sparkles size={17} />
                <span><strong>周报已更新</strong><small>本周进展实时保存</small></span>
              </div>
            </div>
          </div>

          <div className="launch-scroll-cue" aria-hidden="true"><span /> 向下探索</div>
        </section>

        <section className="launch-signal-strip" aria-label="平台能力概览">
          <div className="launch-signal-track">
            {['项目全生命周期', '管理周报', '任务闭环', '业务数据分析', '云盘资料', '开放 API', '项目全生命周期', '管理周报', '任务闭环'].map((item, index) => (
              <span key={`${item}-${index}`}><i /> {item}</span>
            ))}
          </div>
        </section>

        <section id="capabilities" className="launch-section launch-capabilities">
          <div className="launch-section-heading" data-launch-reveal>
            <div className="launch-section-index">01 / CORE CAPABILITIES</div>
            <h2>一套系统，连接业务全流程</h2>
            <p>把日常协作中最重要的四类信息放在同一处，让团队减少重复沟通，把精力留给业务判断。</p>
          </div>

          <div className="launch-capability-grid">
            {capabilities.map((capability, index) => {
              const Icon = capability.icon;
              return (
                <article
                  className={`launch-capability-card launch-tone-${capability.tone}`}
                  key={capability.title}
                  data-launch-reveal
                  style={{ '--reveal-delay': `${index * 90}ms` } as React.CSSProperties}
                >
                  <div className="launch-capability-top">
                    <span>{capability.index}</span>
                    <div><Icon size={22} /></div>
                  </div>
                  <h3>{capability.title}</h3>
                  <p>{capability.description}</p>
                  <footer><span>{capability.detail}</span><ArrowRight size={15} /></footer>
                </article>
              );
            })}
          </div>
        </section>

        <section id="workflow" className="launch-section launch-workflow">
          <div className="launch-workflow-copy" data-launch-reveal>
            <div className="launch-section-index">02 / CONNECTED WORKFLOW</div>
            <h2>信息只录一次，<br />协作自然向前</h2>
            <p>项目不是静态表格，而是一条持续流动的业务链。GCO Link 让每次更新都进入正确的位置，并自然传递给下一位参与者。</p>
            <ul>
              <li><Check size={16} /> 同一项目贯穿进度、周报、任务与文件</li>
              <li><Check size={16} /> 历史周连续留痕，重要变化可追溯</li>
              <li><Check size={16} /> 负责人视角自动聚合，减少来回查找</li>
            </ul>
          </div>

          <div className="launch-flow-board" data-launch-reveal>
            <div className="launch-flow-line" aria-hidden="true"><i /></div>
            {flowSteps.map((step, index) => {
              const Icon = step.icon;
              return (
                <div className="launch-flow-step" key={step.label}>
                  <span className="launch-flow-number">0{index + 1}</span>
                  <div className="launch-flow-icon"><Icon size={20} /></div>
                  <div><strong>{step.label}</strong><small>{step.meta}</small></div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="launch-section launch-insight">
          <div className="launch-insight-panel" data-launch-reveal>
            <div className="launch-insight-copy">
              <div className="launch-section-index">03 / FROM DATA TO INSIGHT</div>
              <h2>不只记录发生了什么，<br />更快看见下一步。</h2>
              <p>工作台自动汇聚业务进展、项目规模、团队参与和近期变动，让数据从记录工具变成行动依据。</p>
              <div className="launch-insight-tags">
                <span>推进时长</span><span>规模结构</span><span>团队负荷</span><span>近期动态</span>
              </div>
            </div>

            <div className="launch-insight-visual" aria-hidden="true">
              <div className="launch-ring launch-ring-one"><span>20<small>推进中</small></span></div>
              <div className="launch-ring launch-ring-two" />
              <div className="launch-stat launch-stat-one"><small>本月编辑</small><strong>128</strong><i>+18%</i></div>
              <div className="launch-stat launch-stat-two"><small>按时完成率</small><strong>94%</strong><i>稳定</i></div>
            </div>
          </div>
        </section>

        <section id="security" className="launch-section launch-security">
          <div className="launch-section-heading launch-section-heading-left" data-launch-reveal>
            <div className="launch-section-index">04 / SECURE & OPEN</div>
            <h2>安全地协作，开放地连接</h2>
            <p>面向企业业务场景设计，把数据权限、操作记录和外部连接能力放进统一边界。</p>
          </div>

          <div className="launch-security-grid">
            <article data-launch-reveal>
              <LockKeyhole size={23} />
              <div><h3>身份与权限</h3><p>按账号和角色控制访问范围，关键业务数据始终处于明确边界内。</p></div>
            </article>
            <article data-launch-reveal>
              <ShieldCheck size={23} />
              <div><h3>过程可追溯</h3><p>业务更新持续留痕，历史周与编辑记录让团队协作更清晰。</p></div>
            </article>
            <article data-launch-reveal>
              <Globe2 size={23} />
              <div><h3>开放连接</h3><p>通过 API、邮件与消息通知连接本地工具和团队沟通场景。</p></div>
            </article>
          </div>
        </section>

        <section className="launch-final-cta">
          <div className="launch-final-grid" aria-hidden="true" />
          <div data-launch-reveal>
            <span>GCO LINK</span>
            <h2>让业务推进，更清晰、更连续。</h2>
            <p>从今天开始，把每一次更新变成团队共同的业务记忆。</p>
            <Link className="launch-button launch-button-light" to={appHref}>
              {isAuthenticated ? '返回工作台' : '立即进入系统'} <ArrowRight size={17} />
            </Link>
          </div>
        </section>
      </main>

      <footer className="launch-footer">
        <div className="launch-brand launch-brand-footer">
          <span className="launch-brand-mark"><img src="/lianheng-mark.png" alt="" /></span>
          <span className="launch-brand-copy"><strong>GCO Link</strong><small>联衡信托 · 国际业务协作平台</small></span>
        </div>
        <span>连接项目、数据与每一位参与者</span>
        <span>© 2026 全球资本运营部</span>
      </footer>
    </div>
  );
}
