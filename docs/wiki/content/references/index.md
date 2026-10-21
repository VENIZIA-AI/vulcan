---
title: References
description: Look up the exact contract for VULCAN configuration keys, commands, rules, hooks, okf, and atlas.
---

# References

Find the exact contract for keys, commands, and messages. The [guides](/guides/) explain why each part exists.

<div class="guide-cards">

<a href="/references/configuration/" class="guide-card highlight">
<h3>Configuration</h3>
<p>Schema and options for the project configuration file.</p>
</a>

<a href="/references/commands/" class="guide-card">
<h3>Commands</h3>
<p>Every vulcan command: init, add, sync, doctor, upgrade and x.</p>
</a>

<a href="/references/presets" class="guide-card">
<h3>Presets</h3>
<p>The format a framework uses to ship an app template.</p>
</a>

<a href="/references/prompts" class="guide-card">
<h3>Interactive prompts</h3>
<p>The menus init, add and sync draw in a terminal, and what they do without one.</p>
</a>

<a href="/references/rules" class="guide-card">
<h3>Rules</h3>
<p>Base rules and extension rules that govern agent actions.</p>
</a>

<a href="/references/hooks/" class="guide-card">
<h3>Hooks</h3>
<p>The hooks VULCAN registers, what they check and when they run.</p>
</a>

<a href="/references/okf/" class="guide-card">
<h3>okf</h3>
<p>Tooling to validate, generate, and visualize the knowledge bundle.</p>
</a>

<a href="/references/atlas/" class="guide-card">
<h3>atlas</h3>
<p>Search server and MCP tools for code and documentation.</p>
</a>

</div>

## Find What You Need

<div class="roadmap">

<div class="roadmap-stage">
<div class="stage-header">
<span class="stage-num">1</span>
<h4>A line from doctor</h4>
</div>
<p><a href="/references/commands/doctor">vulcan doctor</a> then <a href="/references/commands/sync">vulcan sync</a></p>
<span class="stage-desc">Find the check that failed and the fix.</span>
</div>

<div class="roadmap-stage">
<div class="stage-header">
<span class="stage-num">2</span>
<h4>Setting up a project</h4>
</div>
<p><a href="/references/commands/init">vulcan init</a> - <a href="/references/commands/add">vulcan add</a> - <a href="/references/configuration/">Configuration</a> - <a href="/references/rules">Rules</a></p>
<span class="stage-desc">Scaffold project files or a new monorepo, add apps, configure options, and review agent rules.</span>
</div>

<div class="roadmap-stage">
<div class="stage-header">
<span class="stage-num">3</span>
<h4>Guarding the agent</h4>
</div>
<p><a href="/references/hooks/remote-host-guard">Remote-host guard</a></p>
<span class="stage-desc">Intercept tool calls and configure host allowlists for outbound requests.</span>
</div>

<div class="roadmap-stage">
<div class="stage-header">
<span class="stage-num">4</span>
<h4>Knowledge bundle</h4>
</div>
<p><a href="/references/okf/">okf</a> - <a href="/references/okf/renderers">okf renderers</a></p>
<span class="stage-desc">Validate knowledge bundles and generate markdown references from source code.</span>
</div>

<div class="roadmap-stage">
<div class="stage-header">
<span class="stage-num">5</span>
<h4>Search with atlas</h4>
</div>
<p><a href="/references/atlas/">atlas</a> - <a href="/references/atlas/tools">atlas tools</a> - <a href="/references/atlas/sources">atlas sources</a></p>
<span class="stage-desc">Search documentation, look up symbols, and configure external sources over MCP.</span>
</div>

<div class="roadmap-stage">
<div class="stage-header">
<span class="stage-num">6</span>
<h4>Shipping an app template</h4>
</div>
<p><a href="/references/presets">Presets</a></p>
<span class="stage-desc">Write the preset a framework ships so vulcan init and add can create its apps.</span>
</div>

</div>
