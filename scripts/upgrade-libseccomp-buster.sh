#!/bin/bash

# Upgrades libseccomp2 from buster-backports on 32-bit Raspberry Pi OS Buster.
# See https://github.com/konzept7/MyAppCafeControl/issues/16
#
# libseccomp2 2.3.3 (newest in Buster) does not know the 64-bit time_t
# syscalls used by Alpine >= 3.13 on 32-bit ARM. Docker's default seccomp
# profile then rejects them and containers based on current Alpine images
# segfault on start (exit 139).
#
# Usage: upgrade-libseccomp-buster.sh [--mark-restart <file>]
#   --mark-restart <file>  touch <file> before and after the upgrade. The
#                          control program restarts the Docker daemon the next
#                          time it stops the whole compose stack and then
#                          removes the file. Without the option, Docker is not
#                          restarted (the caller reboots or restarts Docker
#                          itself).
#
# Exit codes: 0 = upgraded, already up to date or not applicable on this box.
#             1 = the upgrade failed and should be retried.
#
# This script never restarts Docker, because that restarts all containers,
# including the running server.

set -u

min_version=2.4.2
backports_list=/etc/apt/sources.list.d/buster-backports.list
backports_line='deb http://archive.debian.org/debian buster-backports main'
# Debian 11 and 12 archive signing keys, the archive.debian.org
# buster-backports index is signed with them
archive_keys="0E98404D386FA1D9 6ED0E7B82643E131"
archive_key_urls="https://ftp-master.debian.org/keys/archive-key-11.asc https://ftp-master.debian.org/keys/archive-key-12.asc"

marker=""
while [ $# -gt 0 ]; do
    case "$1" in
        --mark-restart)
            marker=${2:-}
            if [ -z "$marker" ]; then
                echo "--mark-restart needs a file name" >&2
                exit 1
            fi
            shift 2
            ;;
        *)
            echo "unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

say() {
    echo "$(date) libseccomp2: $*"
}

installed_version() {
    dpkg-query -W -f='${Version}' libseccomp2 2>/dev/null
}

# --- guards: everything that does not apply exits 0 -------------------------

codename=""
if [ -r /etc/os-release ]; then
    codename=$(. /etc/os-release && echo "${VERSION_CODENAME:-}")
fi
if [ "$codename" != "buster" ]; then
    say "OS codename is '${codename:-unknown}', not buster. Nothing to do."
    exit 0
fi

arch=$(dpkg --print-architecture 2>/dev/null)
if [ "$arch" != "armhf" ]; then
    say "dpkg architecture is '$arch', not armhf. Nothing to do."
    exit 0
fi

# Debian's armhf packages need ARMv7. Pi Zero/1 (armv6l) would crash with
# illegal instructions, so leave them alone.
cpu=$(uname -m)
if [ "$cpu" = "armv6l" ]; then
    say "CPU is armv6l, Debian armhf packages need ARMv7. Skipping."
    exit 0
fi

current=$(installed_version)
if [ -z "$current" ]; then
    say "libseccomp2 is not installed. Nothing to do."
    exit 0
fi
if dpkg --compare-versions "$current" ge "$min_version"; then
    say "installed version $current is already >= $min_version. Nothing to do."
    exit 0
fi

say "installed version $current is older than $min_version, upgrading from buster-backports"

# Record the restart intent BEFORE touching the package. A retry after a
# successful install takes the "already >= 2.4.2" exit above and would never
# write the marker again, so writing it only afterwards could lose it. If the
# install below fails, the marker stays and the control program restarts
# Docker once at the next stack stop; that is harmless because the stack is
# already down at that point.
if [ -n "$marker" ]; then
    if ! touch "$marker"; then
        say "could not write restart marker $marker, not upgrading"
        exit 1
    fi
fi

# --- apt sources -------------------------------------------------------------

# Raspbian moved Buster to legacy.raspbian.org in Nov 2025. The old host has no
# Release file anymore and makes every 'apt-get update' fail.
source_files=""
for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list; do
    if [ -f "$f" ] && grep -q 'raspbian.raspberrypi.org' "$f"; then
        source_files="$source_files $f"
    fi
done
if [ -n "$source_files" ]; then
    say "switching$source_files to legacy.raspbian.org"
    # shellcheck disable=SC2086
    sudo sed -i 's|raspbian.raspberrypi.org|legacy.raspbian.org|g' $source_files || exit 1
fi

if [ "$(cat "$backports_list" 2>/dev/null)" != "$backports_line" ]; then
    say "adding $backports_list"
    echo "$backports_line" | sudo tee "$backports_list" > /dev/null || exit 1
fi

# --- signing keys ------------------------------------------------------------

say "importing Debian archive keys $archive_keys"
# shellcheck disable=SC2086
if ! sudo apt-key adv --keyserver keyserver.ubuntu.com --recv-keys $archive_keys; then
    say "keyserver import failed, falling back to ftp-master.debian.org over https"
    for url in $archive_key_urls; do
        if ! wget -qO- "$url" | sudo apt-key add -; then
            say "could not import key from $url"
            exit 1
        fi
    done
fi

# --- install -----------------------------------------------------------------

# Refresh all sources so later apt runs on this box work again. Unrelated
# broken sources must not block the fix, so only warn here.
if ! sudo apt-get update -o Acquire::Check-Valid-Until=false; then
    say "warning: apt-get update reported errors for some sources, continuing"
fi

# Refresh buster-backports on its own. This one has to succeed, it also fails
# when the signing keys are missing.
if ! sudo apt-get update \
    -o Acquire::Check-Valid-Until=false \
    -o Dir::Etc::sourcelist="$backports_list" \
    -o Dir::Etc::sourceparts=- \
    -o APT::Get::List-Cleanup=0; then
    say "apt-get update for buster-backports failed"
    exit 1
fi

if ! sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -t buster-backports libseccomp2; then
    say "apt-get install from buster-backports failed"
    exit 1
fi

current=$(installed_version)
if ! dpkg --compare-versions "${current:-0}" ge "$min_version"; then
    say "after the install the version is still '$current'"
    exit 1
fi
say "upgraded to $current"

if [ -n "$marker" ]; then
    # Refresh the marker: if the control program consumed it while apt was
    # still installing, Docker was restarted with the old library.
    if touch "$marker"; then
        say "Docker restart is pending, marker $marker written"
    else
        say "warning: could not refresh restart marker $marker, keeping the one written before the install"
    fi
else
    say "Docker was not restarted. Containers keep the old seccomp behaviour until Docker restarts or the box reboots."
fi
exit 0
