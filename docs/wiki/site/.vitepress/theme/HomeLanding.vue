<template>
  <div class="vu-landing">
    <div class="vu-glow" aria-hidden="true" />

    <!-- ── Hero (split: copy left, code window right) ──────────────────── -->
    <div class="vu-wrap">
      <section class="vu-hero">
        <div class="vu-hero__copy">
          <div class="vu-eyebrow">
            <img src="/logo.svg" alt="VULCAN" class="vu-eyebrow__logo" />
            <span class="vu-eyebrow__dot" />Bun · TypeScript · OKF · MCP
          </div>
          <h1>One agent setup<br /><span class="vu-gtext">for every project</span></h1>
          <p class="vu-lede">
            Rules, hooks, a knowledge bundle and a search server for your coding agent, from one config file and one pinned devDependency.
          </p>
          <div class="vu-cta">
            <a href="/guides/get-started/what-is-vulcan" class="vu-btn vu-btn--primary">Get Started &#x2192;</a>
            <a href="https://github.com/VENIZIA-AI/vulcan" class="vu-btn vu-btn--secondary">&#x2605; Star on GitHub</a>
          </div>
          <div class="vu-stats">
            <div class="vu-stat">
              <div class="vu-stat__n vu-gtext">37</div>
              <div class="vu-stat__l">base rules</div>
            </div>
            <div class="vu-stat">
              <div class="vu-stat__n vu-gtext">13</div>
              <div class="vu-stat__l">doctor checks</div>
            </div>
            <div class="vu-stat">
              <div class="vu-stat__n vu-gtext">5</div>
              <div class="vu-stat__l">atlas tools</div>
            </div>
          </div>
        </div>

        <div class="vu-code-win">
          <div class="vu-code-win__bar">
            <span class="vu-code-win__dot" style="background:var(--vu-honey)" />
            <span class="vu-code-win__dot" style="background:var(--vu-yellow)" />
            <span class="vu-code-win__dot" style="background:var(--vu-sienna)" />
            <span class="vu-code-win__filename">.configs/vulcan.config.mts</span>
            <span class="vu-code-win__tag">ts</span>
          </div>
          <!-- v-pre: skip Vue template compilation inside the code sample -->
          <pre v-pre><span class="vu-k">import type</span> { <span class="vu-c">VulcanConfig</span> } <span class="vu-k">from</span> <span class="vu-s">'@venizia/vulcan'</span>;

<span class="vu-k">export default</span> {
  <span class="vu-p">agents</span>: [<span class="vu-s">'claude'</span>],
  <span class="vu-p">rules</span>: { <span class="vu-s">'V-W-01'</span>: <span class="vu-s">'on-user-word'</span> },
  <span class="vu-p">packages</span>: [{ <span class="vu-p">dir</span>: <span class="vu-s">'api'</span>, <span class="vu-p">name</span>: <span class="vu-s">'@acme/api'</span> }],
  <span class="vu-p">okf</span>: { <span class="vu-p">renderers</span>: [<span class="vu-s">'makefile-targets'</span>] },
  <span class="vu-p">remoteHosts</span>: { <span class="vu-p">trusted</span>: [<span class="vu-s">'lab1'</span>], <span class="vu-p">readOnly</span>: [<span class="vu-s">'prod1'</span>] },
} <span class="vu-k">satisfies</span> <span class="vu-c">VulcanConfig</span>;</pre>
        </div>
      </section>
    </div>

    <!-- ── 6 feature cards ──────────────────────────────────────────────── -->
    <div class="vu-divider" />
    <div class="vu-wrap">
      <section class="vu-section">
        <div class="vu-section-head">
          <div class="vu-label">Core Capabilities</div>
          <h2>Everything your agent needs</h2>
          <p>Shared rules, safety hooks, project knowledge and semantic search.</p>
        </div>
        <div class="vu-features">
          <a href="/references/rules" class="vu-fcard">
            <div class="vu-fcard__icon">
              <!-- shield / base rules -->
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
            <h3>Base rules</h3>
            <p>Thirty-seven non-negotiable coding and process standards shared across all projects.</p>
          </a>
          <a href="/guides/core-concepts/hooks-and-guards" class="vu-fcard">
            <div class="vu-fcard__icon">
              <!-- lock / hooks -->
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <h3>Hooks that ask</h3>
            <p>Intercept destructive operations, database writes, and untrusted remote host commands.</p>
          </a>
          <a href="/guides/core-concepts/knowledge-bundle" class="vu-fcard">
            <div class="vu-fcard__icon">
              <!-- book / knowledge -->
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              </svg>
            </div>
            <h3>Knowledge bundle</h3>
            <p>OKF-validated markdown architecture facts curated specifically for coding agents.</p>
          </a>
          <a href="/guides/core-concepts/atlas" class="vu-fcard">
            <div class="vu-fcard__icon">
              <!-- search / atlas -->
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
            <h3>Atlas search</h3>
            <p>Model Context Protocol server exposing symbol index and cross-repository search.</p>
          </a>
          <a href="/references/commands/doctor" class="vu-fcard">
            <div class="vu-fcard__icon">
              <!-- check-circle / doctor -->
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </div>
            <h3>Doctor</h3>
            <p>Thirteen automated diagnostic checks verifying contract adherence and configuration integrity.</p>
          </a>
          <a href="/references/commands/" class="vu-fcard">
            <div class="vu-fcard__icon">
              <!-- refresh / one upgrade -->
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </div>
            <h3>One upgrade</h3>
            <p>Synchronize adapters, skills, and configuration from a single devDependency bump.</p>
          </a>
        </div>
      </section>
    </div>

    <!-- ── Learning roadmap ─────────────────────────────────────────────── -->
    <div class="vu-divider" />
    <div class="vu-wrap">
      <section class="vu-section">
        <div class="vu-section-head">
          <div class="vu-label">Learning Path</div>
          <h2>Get started with VULCAN</h2>
          <p>Follow three stages to adopt and configure VULCAN.</p>
        </div>
        <div class="roadmap">
          <div class="roadmap-stage">
            <div class="stage-header">
              <span class="stage-num">1</span>
              <h4>Understand it</h4>
            </div>
            <p><a href="/guides/get-started/what-is-vulcan">What is VULCAN</a></p>
            <div class="stage-desc">Learn why VULCAN exists, what it bundles, and how it standardizes agent workflows.</div>
          </div>
          <div class="roadmap-stage">
            <div class="stage-header">
              <span class="stage-num">2</span>
              <h4>Set it up</h4>
            </div>
            <p>
              <a href="/guides/get-started/adopt-vulcan">Adopt VULCAN</a> &middot;
              <a href="/guides/get-started/first-day">Your first day</a>
            </p>
            <div class="stage-desc">Initialize configuration, sync adapters, and run doctor checks in your repository.</div>
          </div>
          <div class="roadmap-stage">
            <div class="stage-header">
              <span class="stage-num">3</span>
              <h4>Look things up</h4>
            </div>
            <p><a href="/references/">References</a></p>
            <div class="stage-desc">Browse commands, configuration options, rule IDs, hook behaviors, and Atlas tools.</div>
          </div>
        </div>
      </section>
    </div>

    <!-- ── Closing call to action ───────────────────────────────────────── -->
    <div class="vu-divider" />
    <div class="vu-wrap">
      <section class="vu-footer-cta">
        <h2>One setup for <span class="vu-gtext">every project</span></h2>
        <p>Give every agent the same contract, boundaries, and knowledge tools.</p>
        <div class="vu-cta">
          <a href="/guides/get-started/what-is-vulcan" class="vu-btn vu-btn--primary">Get Started &#x2192;</a>
          <a href="/references/" class="vu-btn vu-btn--secondary">Browse References</a>
        </div>
      </section>
    </div>
  </div>
</template>
