#!/bin/bash

# Keeps dhcpcd away from Docker's interfaces and restarts dhcpcd if it dies.
#
# dhcpcd on Raspberry Pi OS buster/bullseye can segfault when Docker creates or
# removes many veth/bridge interfaces at once (container recreation, boot). Its
# unit has no Restart=, so nobody renews the DHCP lease on eth0 afterwards and
# the box drops off the network when the lease expires, up to 24 h later.
#
# Exit codes: 0 = applied, already applied or not applicable (no dhcpcd).
#             1 = the configuration could not be written, retry.
#
# A running dhcpcd is deliberately not restarted: the unit's ExecStop is
# 'dhcpcd -x', which removes the address from eth0 and cuts off the box,
# including the tunnel this may be run through. denyinterfaces takes effect the
# next time dhcpcd starts (reboot, or the automatic restart after a crash).

set -u

conf=/etc/dhcpcd.conf
backup=/etc/dhcpcd.conf.before-denyinterfaces
deny_line='denyinterfaces veth* br-* docker*'
dropin_dir=/etc/systemd/system/dhcpcd.service.d
dropin=$dropin_dir/restart.conf
# StartLimitIntervalSec=0: never give up, a dead dhcpcd costs the box its address
dropin_content='[Unit]
StartLimitIntervalSec=0

[Service]
Restart=always
RestartSec=5'

say() {
    echo "$(date) dhcpcd: $*"
}

# --- guards: everything that does not apply exits 0 -------------------------

if [ ! -f "$conf" ]; then
    say "$conf does not exist, dhcpcd is not used on this box. Nothing to do."
    exit 0
fi
if ! systemctl cat dhcpcd.service > /dev/null 2>&1; then
    say "there is no dhcpcd.service on this box. Nothing to do."
    exit 0
fi

# --- denyinterfaces ------------------------------------------------------------

if sudo grep -qxF "$deny_line" "$conf"; then
    say "$conf already contains '$deny_line'"
else
    if [ ! -f "$backup" ]; then
        sudo cp -p "$conf" "$backup" || { say "could not back up $conf"; exit 1; }
    fi
    # denyinterfaces is a global option and must come before any 'interface'
    # block, so it goes on top. Write a copy (same owner and mode) and move it
    # over the original, so an interruption cannot leave a truncated file.
    tmp=$conf.myappcafe-tmp
    sudo cp -p "$conf" "$tmp" || { say "could not create $tmp"; exit 1; }
    if ! { echo "# MyAppCafe: Docker interface churn crashes dhcpcd, see scripts/dhcpcd-ignore-docker.sh"
           echo "$deny_line"
           echo
           sudo cat "$conf"
         } | sudo tee "$tmp" > /dev/null; then
        sudo rm -f "$tmp"
        say "could not write $tmp"
        exit 1
    fi
    sudo mv "$tmp" "$conf" || { say "could not replace $conf"; exit 1; }
    say "added '$deny_line' to $conf (backup in $backup), effective the next time dhcpcd starts"
fi

# --- restart on crash ----------------------------------------------------------

if [ "$(cat "$dropin" 2>/dev/null)" = "$dropin_content" ]; then
    say "$dropin is up to date"
else
    sudo mkdir -p "$dropin_dir" || { say "could not create $dropin_dir"; exit 1; }
    printf '%s\n' "$dropin_content" | sudo tee "$dropin" > /dev/null || { say "could not write $dropin"; exit 1; }
    sudo systemctl daemon-reload || { say "systemctl daemon-reload failed"; exit 1; }
    say "wrote $dropin"
fi

# --- start dhcpcd if it already crashed -----------------------------------------

# Only if enabled: on boxes where another network manager owns eth0, starting
# dhcpcd would fight it. A plain start keeps the current address on eth0.
if systemctl is-enabled --quiet dhcpcd.service && ! systemctl is-active --quiet dhcpcd.service; then
    say "dhcpcd is enabled but not running, starting it"
    if ! sudo systemctl start dhcpcd.service; then
        # not fatal: the configuration is in place, failing here would only
        # block all later once scripts on this box
        say "warning: starting dhcpcd failed, check 'systemctl status dhcpcd'"
    fi
fi

say "done"
exit 0
