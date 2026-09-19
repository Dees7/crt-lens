# SecureCRT: one-time setup

> 🇷🇺 Русская версия — [README.ru.md](README.ru.md).

The `crt` preset in crt-lens opens a SecureCRT tab. The extension itself knows nothing about
SecureCRT — it just writes a job file and launches the binary. What delivers the command into the
already running application is a wrapper session, and that has to be installed once, by hand.

The fast way: in `Preferences → Extensions → crt-lens` press **`Разложить примеры SecureCRT`**
("write out the SecureCRT examples") — the files land in `~/.freelens/crt-lens/securecrt/` with the
script path already substituted into the session. Only step 2 is left.

## 1. The tab script

Put `open-shell.py` anywhere you like — for example
`~/.freelens/crt-lens/securecrt/open-shell.py`. It configures nothing: when the tab connects, it
looks at the tab title, finds the matching job next to it
(`<working dir>/jobs/<title>.sh` or `.cmd`) and runs it.

## 2. The wrapper session

Copy `crt-lens.ini` into the SecureCRT sessions directory:

| OS | Where |
| --- | --- |
| macOS | `~/Library/Application Support/VanDyke/SecureCRT/Config/Sessions/crt-lens.ini` |
| Windows | `%APPDATA%\VanDyke\Config\Sessions\crt-lens.ini` |

and replace `{{script}}` in it with the full path to `open-shell.py` (the "write out the examples"
button does that for you).

The same can be done through the UI: create a session named `crt-lens` with the **Local Shell**
protocol and, in `Session Options → Terminal → Advanced`, enable **Use script file** pointing at
`open-shell.py`.

The session name must match the one in the preset's argv (`/S crt-lens`).

## 3. Single Instance

In SecureCRT `Global Options`, enable **Single Instance**. Without it every launch of the binary
starts a separate application, and the tab opens outside your working window.

If you would rather not change a global setting, you can pass your own config directory as
arguments in the preset's argv (this works only while SecureCRT is already running):

```yaml
terminals:
  crt:
    job: posix
    darwin:
      argv: ["/Applications/SecureCRT.app/Contents/MacOS/SecureCRT", "/F", "/Users/<you>/.freelens/crt-lens/crt-config", "/T", "/N", "{{title}}", "/S", "crt-lens"]
```

## Why this way and not something simpler

Verified on SecureCRT 9.4.1 (macOS):

| Attempt | Result |
| --- | --- |
| `/SCRIPT` on the command line | **never reaches** an already running instance |
| `Shell Path` / `Shell Arguments` in the session | **ignored** by the macOS build |
| local shell command set through the UI | stored encrypted in `Local Shell Command Pre-connect V2` |
| plaintext in that same field | ignored |
| `Use Script File` + `Script Filename V2` | **works**, the script runs in its own tab |

SecureCRT scripts are one per tab, so an agent running in a neighbouring tab does not interfere
with opening a shell.

A side benefit of addressing the job by title: reconnecting the tab runs the command again. The
flip side is that two targets with the same title share one job file; if you ever hit that,
separate them with a `title` template.
