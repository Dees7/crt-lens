# $language = "Python3"
# $interface = "1.0"
"""crt-lens: runs the job in the tab whose local shell has just connected.

Which job is worked out from the tab caption: the extension starts the session
as `/N <title>` and writes <work dir>/jobs/<title>.sh (or .cmd on Windows) next
to it. In the file name everything but letters, digits, dot, minus and
underscore is replaced by an underscore — the same rules as in
src/launch/job.ts.

The work directory is looked up the way the extension looks it up: first
~/.freelens/crt-lens, then ~/.k8slens/crt-lens.

The script asks nothing and shows no dialogs: it runs on every connect of the
tab, reconnects included, and a modal window at that moment would only get in
the way.

SecureCRT parses the header (# $language / # $interface) strictly: any other
comment in those two lines gives "Invalid character encountered in script
header".
"""
import json
import os
import re
import time

HOMES = ["~/.freelens/crt-lens", "~/.k8slens/crt-lens"]
WINDOWS = os.name == "nt"


def work_dir():
    paths = [os.path.expanduser(home) for home in HOMES]

    for path in paths:
        if os.path.isdir(path):
            return path

    return paths[0]


def job_path(caption):
    name = re.sub(r"[^A-Za-z0-9._-]", "_", str(caption).strip())
    jobs = os.path.join(work_dir(), "jobs")
    # the extension writes the job for its own shell; look for both in case the
    # directory is shared
    order = [".cmd", ".sh"] if WINDOWS else [".sh", ".cmd"]

    for suffix in order:
        candidate = os.path.join(jobs, name + suffix)

        if os.path.exists(candidate):
            return candidate

    return os.path.join(jobs, name + order[0])


def debug(**fields):
    # put an empty file named debug next to the jobs directory and the script
    # will record which tab it saw and which job it looked for
    flag = os.path.join(work_dir(), "debug")

    if not os.path.exists(flag):
        return

    fields["at"] = time.strftime("%H:%M:%S")

    try:
        with open(os.path.join(work_dir(), "debug.json"), "w") as handle:
            json.dump(fields, handle, ensure_ascii=False, indent=1)
    except Exception:
        pass


def status(tab, text):
    try:
        tab.Session.SetStatusText("crt-lens: " + text)
    except Exception:
        pass


def main():
    tab = crt.GetScriptTab()  # noqa: F821 — crt comes from SecureCRT
    caption = str(tab.Caption)
    job = job_path(caption)

    debug(caption=caption, job=job, exists=os.path.exists(job))

    if not os.path.exists(job):
        status(tab, "job not found (%s)" % job)
        return

    if WINDOWS:
        # call + exit repeats what exec does: leaving kubectl closes the tab
        # instead of dropping back into a cmd.exe with nowhere to go
        tab.Screen.Send('call "%s" & exit\r\n' % job)
    else:
        tab.Screen.Send("exec %s\n" % job)


try:
    main()
except Exception as error:
    debug(error=str(error))
    raise
