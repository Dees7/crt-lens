# crt-lens

A [Freelens](https://github.com/freelensapp/freelens) extension that turns a YAML file into
**buttons in the menus of your cluster objects** — like `plugins.yaml` in [k9s](https://k9scli.io/topics/plugins/),
but with the result shown inside Freelens.

**One button = one command on one object.** You write the command, pick the objects it shows up
on, and choose where the output goes: the **terminal in the Freelens dock**, an **external
terminal** (SecureCRT, iTerm, kitty, Windows Terminal…), the **built-in log viewer**, or a **URL
in the browser**. It works on *any* kind — Pods, containers, Nodes, Namespaces, Deployments,
StatefulSets, Jobs, your own CRDs.

> 🇷🇺 Русская версия — [README.ru.md](README.ru.md).

![crt-lens in action](crt-lens.png)

*Custom menu items (SecureCRT, CloudLogging, Monitoring, Debug, Gdb), custom one-click columns in
the pod list, and the dock log viewer — all of it comes from one YAML file.*

## ⚡ What you can build with it

Instead of installing one extension per action, you describe the action yourself:

| You want | The button |
| --- | --- |
| Shell into a container in an external terminal | `type: ext`, `scopes: [containers]` |
| Shell into a container in the Freelens dock | `type: local`, `scopes: [containers]` |
| Root shell on a node (`kubectl run` on a debug image) | `type: local` or `ext`, `scopes: [nodes]` |
| `kubectl debug` with an ephemeral netshoot/multitool container | `type: ext`, `scopes: [containers]` |
| Tail the logs of **every pod** of a Deployment in one stream | `type: local`, `cmd: kubectl logs deploy/x --all-pods --prefix -f` |
| Open the Freelens log viewer on a Deployment / DaemonSet / Job | `type: logs`, `scopes: [Deployment, …]` |
| Open your Grafana / Kibana / CloudLogging / Jaeger with the right filters | `type: url` |
| `kubectl port-forward`, `stern`, `kubectl-neat`, `velero`, `psql`, `redis-cli`, `tcpdump`… | any `cmd` you like |
| A one-click icon in the object list, not only in the ⋮ menu (only freelens with my patches. not upstream)| `column: true` |

So it covers what these extensions do, and anything else you can express as a command line:

| Extension | crt-lens equivalent |
| --- | --- |
| [Multi Pod Logs](https://github.com/andrea-falco/freelens-multi-pod-logs) | a `local` button running `kubectl logs {{kind}}/{{name}} --all-pods --prefix -f`, or a `logs` button for the native viewer |
| [Node / Pod Menu](https://github.com/freelensapp/freelens-node-pod-menu) | buttons with `scopes: [nodes]` and `scopes: [containers]` |
| [Debug Pod](https://github.com/rguleryuz/freelens-debug-pod-extension) | a button running `kubectl debug --profile=general --image=…` |
| an in-house "open the dashboard for this pod" extension | a `url` button with per-cluster values in `vars` |

Everything is data: no TypeScript, no build, no reload of the app for a new button — edit the
YAML in `Preferences → Extensions → crt-lens`, save, and the button is there.

## 🚧 Requirements

- **Freelens** `>= 1.0.0` (both 1.x and 2.x are supported, see [Installing](#-installing))
- `kubectl` on your `PATH` — or a path to it in `kubectl_path`
- optional: an external terminal (SecureCRT, iTerm2, kitty, WezTerm, Ghostty, Alacritty,
  Windows Terminal, Git Bash…) if you want `type: ext` buttons
- optional: a one-time manual setup for SecureCRT, see [`examples/securecrt/`](examples/securecrt/README.md)

Anything the button runs must be installed on **your machine**, not in the cluster — the command
is a normal local command line.

## 🧰 Installing

Freelens 1.x and 2.x load extensions differently, so there are two builds — one release asset per
host major. **The package major always matches the Freelens major:**

| Your Freelens | Release tag | Asset to install |
| --- | --- | --- |
| 1.x | `v1.y.z` | `crt-lens-1.y.z.tgz` |
| 2.x | `v2.y.z` | `crt-lens-2.y.z.tgz` |

Check your version in `Freelens → About` (macOS: `Freelens → About Freelens`).

Then, with Freelens running:

1. Open the [Releases page](https://github.com/Dees7/crt-lens/releases) and find the newest tag
   starting with `v1.` or `v2.` — whichever matches your Freelens.
2. Copy the link to its `.tgz` asset (right click → *Copy link address*).
3. In Freelens go to the Extensions view (`Menu → File → Extensions`, or
   `Preferences → Extensions`).
4. Paste the link into the **"Name or file path or URL"** field and press **Install**.
5. Make sure the extension is enabled, then restart Freelens (`Cmd+R` / `Ctrl+R` in the window is
   usually enough).

The asset link always has the same shape, so you can also type it by hand:

```text
https://github.com/Dees7/crt-lens/releases/download/<tag>/crt-lens-<version>.tgz
```

Downloading the `.tgz` and dragging it onto the Extensions view works just as well.

### Upgrading

Go to the Extensions view, uninstall crt-lens, install the new asset, restart Freelens. Your
config file is not touched by this.

### Uninstalling

Extensions view → **Uninstall** next to crt-lens. The config file stays on disk; delete
`~/.freelens/crt-lens.yaml` and `~/.freelens/crt-lens/` if you want it gone too.

### Installing from source

Only needed if you want to change the code. The extension code is shared; everything that differs
between host majors lives on the [`v1`](../../tree/v1) and [`v2`](../../tree/v2) branches —
see `BUILD.md` there.

```sh
git clone https://github.com/Dees7/crt-lens.git
cd crt-lens
git switch v1            # or v2 — matching your Freelens
npm install
npm run build

mkdir -p ~/.freelens/extensions
ln -s "$PWD" ~/.freelens/extensions/crt-lens
```

## ⚙️ Preferences

`Freelens → Preferences → Extensions → crt-lens`. The whole extension is one YAML file, editable
right there (or in your editor of choice). Under the editor there is a **live preview**: which
terminals were found, which buttons came out of the file, and the exact command or URL they would
build for sample objects — plus warnings about the mistakes that would otherwise be silent.

Four buttons under the editor: **Save**, **Re-read** (re-read the file from disk), **Defaults**
(fill the editor with the shipped sample) and **Write out SecureCRT examples**.

The config lives in `~/.freelens/crt-lens.yaml`; if a `~/.k8slens/crt-lens.yaml` from older
versions is next to it, that one is used instead — no need to migrate. The working directory
`~/.freelens/crt-lens/` holds the generated job files.

There is no config until you write one: the editor starts with
[`crt-lens.sample.yaml`](crt-lens.sample.yaml) from the extension package — four ready buttons
(**SecureCRT**, **Logs**, **Dashboard**, **Debug**). Edit it, save it, done.

### Global settings

```yaml
kubectl_path: kubectl                       # path or template, see {{kube_minor}} below
pod_tab_title: '{{pod}}/{{container}}'      # title of the tab a pod button opens
node_tab_title: '{{node}}'
tab_title_max: 32                           # titles are trimmed to this length
default_shell: 'clear; (bash || ash || sh)'
default_node_image: docker.io/alpine:3.13   # image for the default node command
node_namespace: kube-system                 # namespace for the node pod
icon_font: ''                               # font for glyph icons (icon: 'text:…')
default_terminal: ''                        # empty — autodetect by looking for the binary
```

Two more, commented out in the sample — the default commands for `containers` and `nodes`, the
ones you get when a button has no `cmd` of its own:

```yaml
pod_command: '{{kubectl}} --kubeconfig "{{kubeconfig}}" --context {{context}} exec -i -t -n {{namespace}} {{pod}} -c {{container}} -- sh -c {{shell_quoted}}'
node_command: '{{kubectl}} --kubeconfig "{{kubeconfig}}" --context {{context}} -n {{node_namespace}} run {{node_pod}} --rm -it --restart=Never --image {{image}} --overrides {{overrides}}'
```

## 🚀 Features

### The four things a button can do

| `type` | What happens on click |
| --- | --- |
| `local` | runs the command in a **terminal tab in the Freelens dock** — the same terminal the built-in Shell button opens |
| `ext` | runs the command in an **external terminal**: SecureCRT, iTerm, kitty, Windows Terminal… — by a preset from `terminals` |
| `logs` | opens the **built-in Freelens log viewer** — the same tab the native Logs button gives a pod, but you can put it on a workload too |
| `url` | opens a **link in the browser**: logs, dashboard, ticket, anything |
| `crt` | legacy alias for `ext` + `terminal: crt`; old configs keep working |

Any of them can also be a **column in the object list** (`column: true`), not just a menu item (only freelens with my patches. not upstream).

### Button fields

| Field | Meaning |
| --- | --- |
| `id` | identifier; buttons sharing an `id` collapse into one — that is how you override a button for a specific context |
| `name` | menu label and icon tooltip |
| `type` | `local`, `ext`, `url`, `logs` |
| `terminal` | preset name from `terminals` — for `ext` only |
| `icon` | a material icon name, `svg:<name or xml>`, `text:<glyph>`; empty — the terminal icon. Built in: `svg:chart` (a chart, missing from the material set), `svg:terminal` |
| `scopes` | where the button shows up: `containers`, `pods`, `nodes`, `namespaces`, or any kind |
| `title` | template for the tab title |
| `cmd` | the command, for `local` / `ext` |
| `url` | the link, for `url` |
| `query` | a selector: rendered into `{{query}}` and url-encoded `{{query_encoded}}` |
| `shell` / `image` | shell and image used by the default commands |
| `vars` | button-local variables |
| `confirm` | ask for confirmation and show the assembled command first |
| `input` | ask for a string before running and substitute it as `{{input}}` |
| `include_stopped` | show the button on stopped pods/containers too (by default only running ones) |
| `column` | also show the button as a column in the list |
| `rules` | per-target overrides for all of the above, selected by masks |

### Where a button shows up: `scopes`

`containers` — a menu item with a submenu of the pod's containers; the command targets the chosen
container, and clicking the item itself targets the container from the
`kubectl.kubernetes.io/default-container` annotation (or the first one).

`pods`, `nodes`, `namespaces` — the object itself.

**Any kind works too**: `Deployment` (the apiVersion is filled in from a table of well-known
kinds) or an explicit `apps/v1:MyKind` for your own CRDs.

**`containers` and `pods` together** change what the item means: clicking it targets the **whole
pod**, while the containers stay in the submenu. That is how the logs button in the sample works —
the pod has one selector, a container has a narrower one.

A new kind in `scopes` appears after a window reload (`Cmd+R`): Freelens reads the set of kinds
once, when the extension loads. New buttons and new rules are picked up immediately.

### Running and stopped objects

By default a button is only there for something that runs: you cannot shell into a stopped pod, so
buttons scoped to `containers` are absent on a failed pod or a finished job.

`include_stopped: true` lifts that for one button — the logs of a crashed pod or a completed job
are exactly what you want to see. The submenu then also lists stopped containers, each with its
own brick colour (green — running, orange — waiting, hollow — terminated).

### Example: shell into a container, in an external terminal

```yaml
buttons:
  - id: shell
    name: SecureCRT
    type: ext
    terminal: crt
    scopes: [containers, nodes]
    rules:
      - pod: 'deploy*'
        shell: bash
      - namespace: prod
        shell: 'clear; (bash || ash || sh)'
```

No `cmd` — `containers` and `nodes` have sensible default commands (`kubectl exec` and a
`kubectl run` debug pod on the node), and the rules only pick the shell.

### Example: `kubectl debug` with an ephemeral container

```yaml
  - id: debug
    name: Debug
    type: ext
    terminal: ''            # empty — autodetect the terminal
    icon: bug_report
    scopes: [containers]
    confirm: true
    title: 'dbg {{pod}}/{{name}}'
    cmd: '{{kubectl}} --kubeconfig "{{kubeconfig}}" --context {{context}} debug --profile=general -it -n {{namespace}} {{pod}} --target={{name}} --image={{image}} --share-processes -- {{shell}}'
    image: praqma/network-multitool:latest
    shell: bash
    rules:
      - context: '*-prod-*'       # a leaner image in production
        image: busybox:1.36
        shell: sh
```

`confirm: true` shows the fully assembled command and asks before it runs.

### Example: logs of every pod of a workload, in the dock

```yaml
  - id: wl-logs
    name: All pod logs
    type: local
    icon: article
    scopes: [Deployment, StatefulSet, DaemonSet, Job]
    column: true
    include_stopped: true
    title: 'logs {{name}}'
    cmd: >-
      {{kubectl}} --kubeconfig "{{kubeconfig}}" --context {{context}}
      -n {{namespace}} logs {{kind}}/{{name}}
      --all-pods --all-containers --ignore-errors --prefix
      --tail=200 --max-log-requests=100 -f
```

(`--all-pods` needs kubectl ≥ 1.32.)

### Asking for a string first: `input`

A button can ask for a string before it runs — a log filter, a `grep`, a port, a SQL query. The
answer is substituted as `{{input}}` into `cmd`, `url`, `query` and `title`:

```yaml
  - id: wl-logs
    name: All pod logs
    type: local
    scopes: [Deployment, StatefulSet, DaemonSet, Job]
    title: 'logs {{name}}'
    input:
      label: 'Filter — appended to the command'
      # the field opens pre-filled: a normal run is just Enter,
      # you only edit it when you need a different filter
      default: "| grep -i -E 'error|warn'"
      required: false      # true — an empty answer is not accepted
    cmd: >-
      {{kubectl}} --kubeconfig "{{kubeconfig}}" --context {{context}}
      -n {{namespace}} logs {{kind}}/{{name}}
      --all-pods --all-containers --ignore-errors
      --tail=200 --max-log-requests=100 -f {{input}}
```

Short forms: `input: true` — just ask for a string; `input: 'filter'` — the same with a label.

`default` is not grey placeholder text, it is the actual value of the field: the dialog opens with
a working filter already in it, so the normal run is one Enter.

| Substitution | What it holds |
| --- | --- |
| `{{input}}` | the answer as typed |
| `{{userinput}}` | the same value, another name |
| `{{input_quoted}}` | the answer quoted for the shell the command runs in; an empty answer does not become `''` |

The dialog shows the assembled command and rebuilds it on every keystroke, so you can see exactly
where the answer lands. Enter in the field is the same as clicking Run. A separate `confirm` is
pointless on such a button — asking for input *is* the confirmation.

The answer is substituted **as is, unescaped** — that is the point: typing `| grep -i error` gives
you a real pipe in the command. If the answer must be a single argument, use `{{input_quoted}}`.

The preview complains about both silent mistakes: an `input` with no `{{input}}` in any template
(the answer would be asked for and thrown away), and a `{{input}}` with no `input` declared (an
empty string would be substituted).

### Links: `type: url`

A link is built in two steps: `query` is rendered first (if present), then `url`, where the
selector arrives url-encoded as `{{query_encoded}}`. Environment identifiers come from `vars` —
a list of entries behind masks:

```yaml
vars:
  - context: '*'
    set:
      logs_base: https://logs.example.com
      logs_project: demo
      logs_service: my-service

  - context: '*-prod-*'
    set:
      logs_project: prod

buttons:
  - id: logs
    name: Logs
    type: url
    icon: 'svg:chart'
    scopes: [containers, pods, nodes]
    column: true
    include_stopped: true
    query: '{project = "{{logs_project}}", service = "{{logs_service}}", pod = "{{pod}}"}'
    url: '{{logs_base}}/logs?query={{query_encoded}}&from={{from}}&to={{to}}'
    rules:
      - container: '*'
        query: '{project = "{{logs_project}}", service = "{{logs_service}}", pod = "{{pod}}", container = "{{container}}"}'
      - node: '*'
        query: '{project = "{{logs_project}}", service = "{{logs_service}}", node = "{{node}}"}'
```

The `container: '*'` mask is how you say "when a container is selected, the selector is different":
the mask only matches where the target has a container at all. Writing `container: ''` does
nothing — empty values are dropped while parsing.

Each `vars` key is resolved on its own: mask weight → length of the literal part → source (rule
`vars` > button `vars` > the global table) → earlier in the file. So a blanket `context: '*'` entry
can be overridden per cluster for one key, and the other keys of the blanket entry stay.

The default time window is `from: now-1h`, `to: now`; override it with your own `vars` entry.

If the context is missing from `vars`, the link would be incomplete and the button simply does not
show up — better that than sending you into the wrong environment. The reason is visible in the
preferences preview and in devtools.

### Example: a dashboard link

```yaml
  - id: mon
    name: Dashboard
    type: url
    icon: insights
    scopes: [pods]
    column: true
    include_stopped: true
    url: '{{dash_base}}/d/{{dash_id}}?var-cluster={{dash_cluster}}&var-namespace={{namespace}}&var-pod={{pod}}&from=now-1d&to=now'
```

### Logs in the dock: `type: logs`

Opens the native Freelens log viewer — the same tab the pod's Logs button gives you, with its
search, timestamps, word wrap and download. The difference is that this button can sit on a
**workload**: Deployments, StatefulSets, DaemonSets and Jobs have no such item in the app.

```yaml
  - id: dock-logs
    name: Logs
    type: logs
    icon: subject
    scopes: [containers, pods, Deployment, StatefulSet, DaemonSet, Job]
    column: true
    include_stopped: true
```

Such a button needs neither `cmd` nor `url` — it takes the target from the object itself:

1. Pods are found by owner. For DaemonSet, StatefulSet, Job and ReplicaSet that is the object
   itself; a Deployment owns pods through its ReplicaSet and a CronJob through its Jobs, so the
   intermediate link is resolved first.
2. The tab opens on the freshest **running** pod — during a rollout that is the new revision, not
   the dying old one. If nothing runs, the freshest pod overall is used: the logs of a crashed pod
   are exactly what you are after.
3. The container comes from the target: with scope `containers` it is the one picked in the
   submenu, otherwise the `kubectl.kubernetes.io/default-container` annotation, otherwise the first.

From there the tab's own selectors take over: the **Pod** dropdown lists the siblings under the
same owner (for a Deployment — the pods of the current revision), the **Container** dropdown the
containers of the selected pod.

What this button does not do: it does not merge several pods into one stream — one pod at a time,
switched in the dropdown. For a combined tail from all replicas use `type: local` with
`kubectl logs {{kind}}/{{name}} --all-pods --prefix` (needs kubectl ≥ 1.32).

`scopes` for a `logs` button may only contain kinds that have pods: `Pod` (including as
`containers` and `pods`), `Deployment`, `StatefulSet`, `DaemonSet`, `ReplicaSet`, `Job`, `CronJob`.
Anything else is reported in the preview.

### Which button shows up, and which value wins

The masks `context`, `namespace`, `pod`, `container`, `node`, `object`, `kube_version` (glob: `*`,
`?`, `[0-6]`, `[!x]`) can be put on a button, on a rule, and on a `vars` entry. All declared masks
must match; a mask the target cannot have at all (`pod` on a node) counts as not matching.

A mask value can be **a list — that is an "or"**:

```yaml
  - id: logs
    namespace: [prod, temporal]   # visible in prod and temporal, nowhere else
```

The alternatives are globs too (`pod: ['deploy-*', 'worker-?']`). For specificity a list counts as
its weakest alternative: `[prod, '*']` is as coarse as `*`, otherwise it would beat an honest
`namespace: prod`.

A mask with an unusable value (a dict, a number, an empty string, an empty list) is dropped while
parsing — and the button becomes visible **everywhere**. That is why the preferences preview
reports every such case; it no longer passes silently.

- a **button is visible** when all of its masks match;
- buttons with the same `id` collapse: the most specific one wins, ties go to the lower one in the
  file;
- **values** (`cmd`, `shell`, `image`, `url`, `query`, `terminal`) are picked independently of each
  other: rule → button value → default. Among rules the most specific wins, ties go to the upper
  one.

Specificity: mask weight (object name 4, namespace 2, context and version 1 each) → length of the
literal part of the masks → order in the file.

### Templates

Substitutions (case-insensitive): `kubectl`, `kubeconfig`, `context`, `namespace`, `pod`,
`container`, `node`, `name`, `kind`, `api_version`, `button`, `platform`, `node_namespace`,
`node_pod`, `image`, `shell`, `shell_quoted`, `overrides`, `kube_version`, `kube_minor`, `from`,
`to`, `query`, `query_encoded`, `input`, `userinput`, `input_quoted` — plus everything coming from
`vars`.

`shell_quoted` and `overrides` are already escaped for the shell the command will run in (`sh` or
`cmd.exe`) — do not wrap them in quotes yourself. Target names (`pod`, `context`, …) cannot be
shadowed through `vars`: they override the table on purpose.

`{{kubectl}}` is itself a template and knows about `{{kube_version}}` / `{{kube_minor}}`, so you
can keep one kubectl binary per minor version:

```yaml
kubectl_path: '/opt/kubectl/{{kube_minor}}/kubectl'
```

### A column in the object list

`column: true` adds the button as a column in the object list — one column per kind in its
`scopes`, to the right of the built-in ones. Clicking the icon in a row does what clicking the menu
item does; for scope `containers` that is the default container. The menu item stays as well.

The column shows up in the "configure columns" menu (the gear in the table header), where it can be
hidden. A new column appears after `Cmd+R`.

> The column is the `kubeObjectListLayoutColumns` extension point, which exists in our Freelens
> fork only; on a vanilla build the field is ignored and everything else works as before.

### External terminals: `type: ext`

A preset describes what to launch and how. It is data, not code: any preset can be edited or added
without touching the extension.

```yaml
terminals:
  kitty:
    job: posix                 # posix | cmd | none — job file format and quoting style
    darwin:
      argv: ["/Applications/kitty.app/Contents/MacOS/kitty", "--title", "{{title}}", "/bin/bash", "{{job}}"]
    linux:
      argv: ["kitty", "--title", "{{title}}", "/bin/bash", "{{job}}"]
  wt:
    job: cmd
    win32:
      argv: ["wt.exe", "-w", "0", "nt", "--title", "{{title}}", "cmd.exe", "/k", "{{job}}"]
```

Substitutions in `argv`: `{{job}}` — path to the job file, `{{title}}` — tab title, `{{command}}`
and `{{command_quoted}}` — the command itself. The optional `activate` is a second launch that
raises the window, for terminals that do not do it themselves.

Presets shipped in the box, working without a single line of config: `crt`, `terminal`
(Terminal.app), `iterm`, `kitty`, `wezterm`, `ghostty`, `alacritty`, `wt`, `cmd`, `powershell`,
`gitbash`.

All of them are written out in full, with the fields explained, in
[`terminals.sample.yaml`](terminals.sample.yaml) shipped next to the extension: copy an entry into
your config and adjust the binary path, arguments and `activate`. That file changes nothing by
itself; a test keeps it in sync with the code. A preset from your config **replaces** the built-in
one of the same name entirely — it is not merged per platform.

**How the terminal is chosen:** the button's `terminal` (picked by rules, like `cmd`) →
`default_terminal` → autodetection: the first preset that has a section for the current platform
and whose `argv[0]` exists. A preset named explicitly is not checked for the binary — the terminal
may live in a non-standard place.

**The job file.** The command reaches the terminal as a file:
`<working dir>/jobs/<title>.sh` (or `.cmd`), mode 700, kept for a day and cleaned up
automatically. That way it does not have to survive the terminal's own quoting, and that is also
how a SecureCRT tab finds it — the tab only gets the title in `argv`. A preset with `job: none`
gets the command directly in `argv` through `{{command}}`.

The title also addresses the job, so two targets with the same title (after substitution and
trimming to `tab_title_max`) share one file. If that ever happens, separate them with a `title`
template.

### SecureCRT

The `crt` preset is an ordinary preset; everything that makes it special lives in
[`examples/securecrt/`](examples/securecrt/README.md) and is installed **once, by hand**: a wrapper
session and a script that runs the job in the tab. The **Write out SecureCRT examples** button in
the preferences writes the files out and prints what to do with them.

In short: you need a `crt-lens` session (Local Shell + Use Script File → `open-shell.py`) and
**Single Instance** enabled in Global Options. Details, and why it cannot be simpler, are in
[`examples/securecrt/README.md`](examples/securecrt/README.md).

### Windows

The extension is cross-platform: paths, quoting and window activation are chosen by
`process.platform`.

- the `wt`, `cmd`, `powershell`, `gitbash` presets and the `win32` section of `crt` are built in;
- the job file on Windows is a `.cmd` (`@echo off` + the command), quoting is double quotes with
  doubled `"` and `%`; a preset may ask for a `posix` job instead (that is how `gitbash` works);
- SecureCRT: `C:\Program Files\VanDyke Software\SecureCRT\SecureCRT.exe`, sessions in
  `%APPDATA%\VanDyke\Config\Sessions`, and the tab script picks `call … & exit` over `exec`.

> **So far this has only been verified on macOS** — the Windows path has not been exercised on a
> real machine yet.

## 🩺 When a button is missing

- no active cluster — no items at all, with a `[crt-lens]` warning in devtools;
- the pod or container is not running and the button has no `include_stopped`;
- the button's masks did not match;
- there is nothing to open: no command, no link (including because of a missing `vars` entry), no
  terminal preset, or the preset has no section for the current platform;
- no column although `column: true` is set: a build without the column patch, the column hidden
  with the gear, a `context` / `kube_version` mask that did not match, or a missing `Cmd+R`.

All of it is visible in the preferences preview and in devtools.

### Debugging

Put an empty `debug` file into the working directory (`~/.freelens/crt-lens/debug`) and
`open-shell.py` will record in `debug.json` which tab it saw and which job it looked for.

Errors from the extension itself go to the devtools of the Freelens window
(`View → Toggle Developer Tools`), prefixed with `[crt-lens]`; the assembled command or link is
logged there too.

## 🧩 Compatibility with older configs

- no `buttons` section — a single button with `scopes: [containers, nodes]` is assembled from the
  old fields (`name`, `material_icon`, `rules`);
- `type: crt` is read as `ext` + `terminal: crt`, `type: log` as `logs`;
- `securecrt_path`, `securecrt_args`, `session_name`, `activate_app` are no longer settings, but a
  `crt` preset is assembled from them — an old file works unchanged. An explicit `crt` preset in
  `terminals` wins.

## 📄 License

[BSD 3-Clause](LICENSE).
