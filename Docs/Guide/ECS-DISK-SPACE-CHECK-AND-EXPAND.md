# ECS disk space — check usage and expand storage

This guide is for **Alibaba Cloud ECS** instances running JPS (especially the **frontend / app** server). It explains how to see **which** disk is full, how to **free** space safely, and how to **increase** capacity.

Typical trigger: `apt install` fails with:

```text
Error writing to file - write (28: No space left on device)
E: You don't have enough free space in /var/cache/apt/archives/.
```

That means the **root filesystem** (`/`) has no free space—not that your Alicloud account has no storage in general.

**Related:** [JETTY-LIVE-STREAM-DEPLOYMENT.md](./JETTY-LIVE-STREAM-DEPLOYMENT.md) (FFmpeg needs ~0.5–1 GB+ free on `/`), [ALICLOUD-DEPLOYMENT-GUIDE.md](./ALICLOUD-DEPLOYMENT-GUIDE.md) (two-server layout).

---

## Which storage matters

| What you might think | What the server actually uses |
|----------------------|-------------------------------|
| OSS / object storage buckets | **Not** used for `apt`, Docker, or OS packages |
| Space on your PC | Irrelevant to the ECS |
| A large disk in the console that is **unattached** or **unmounted** | Does **not** help until mounted or the system disk is **resized** |
| **Root filesystem `/`** on the system disk | **This** is what must have free space |

Example of a **full** system disk (from `df -h`):

```text
/dev/nvme0n1p3   40G   38G     0  100%  /
```

| Column | Meaning |
|--------|---------|
| **Size** | Total size of `/` (e.g. 40 GiB) |
| **Used** | Space consumed |
| **Avail** | Free space (**0** = full) |
| **Use%** | **100%** = writes will fail |

Docker `overlay` lines at 100% in `df` share the **same** underlying disk—they are not separate disks.

---

## Part 1 — Check current usage (SSH on the ECS)

### Step 1: Filesystem summary

```bash
df -h
```

Focus on the row where **Mounted on** is **`/`**.

### Step 2: All block devices (mounted and unmounted)

```bash
lsblk
```

| Pattern | Meaning |
|---------|---------|
| One disk, one partition on `/` | Single system disk; expand **that** disk or free space on `/` |
| Second disk (e.g. `nvme1n1`, `vdb`) with **no** `MOUNTPOINT` | Cloud disk is attached but **not used**—mount it or ignore until you configure it |

### Step 3: Largest directories on `/`

```bash
sudo du -xh / --max-depth=1 2>/dev/null | sort -h
```

Common heavy paths:

| Path | Typical contents |
|------|------------------|
| `/var/lib/docker` | Images, containers, build cache |
| `/var/cache/apt` | Package download cache |
| `/var/log` | System and application logs |
| `/opt` | Application clones (e.g. `/opt/jetty-planning-system`) |

### Step 4: Docker usage

```bash
docker system df
sudo du -sh /var/lib/docker 2>/dev/null
docker ps -a
docker images
```

Repeated `docker compose build --no-cache` on a **40 GiB** disk often fills `/var/lib/docker`.

### Step 5: Apt cache and logs

```bash
sudo du -sh /var/cache/apt/archives 2>/dev/null
sudo journalctl --disk-usage
```

### Step 6: Alibaba Cloud console (optional)

1. **ECS** → your instance → **Disks** / **Block Storage**.
2. Note **system disk** size (e.g. 40 GiB).
3. Note any **data disks**: attached? size?

Compare console sizes with `lsblk` and `df -h`.

### Step 7: Space needed for FFmpeg (Jetty Live)

If you plan `apt install ffmpeg` on this host:

| Item | Rough space |
|------|-------------|
| FFmpeg + dependencies (installed) | ~0.3–0.6 GiB on `/` |
| Apt download cache (temporary) | up to ~0.2 GiB during install |
| Node.js (if not installed) | ~0.05–0.15 GiB |
| `rtsp-stream-viewer` `npm ci` | ~0.05–0.1 GiB |

**Target:** at least **1–2 GiB** free on `/` before installing; **comfortable** on a Docker host: **2 GiB+**.

Simulate install size without installing:

```bash
sudo apt-get install --simulate ffmpeg
```

Read **Need to get** and **additional disk space will be used**.

---

## Part 2 — Free space without resizing the disk

Try this first if the instance is still reachable over SSH.

```bash
# Apt package cache
sudo apt-get clean

# Systemd logs (example: cap at 200 MiB)
sudo journalctl --vacuum-size=200M

# Remove unused packages
sudo apt-get autoremove -y
```

**Docker** (frontend app server—**do not** use `docker volume prune` if Postgres data lives on this host):

```bash
docker system df
docker container prune -f
docker image prune -f
docker builder prune -f

# If still tight: remove unused images not referenced by any container
# docker image prune -a -f
```

**Check result:**

```bash
df -h /
```

Proceed to installs or resize only when **Avail** is at least **1 GiB**.

---

## Part 3 — Increase disk capacity

### Option A — Resize the **system disk** (recommended)

Use when `/` is on the only disk (e.g. `nvme0n1p3`) and you need more room on `/` for OS, Docker, and `apt`.

#### A1. In Alibaba Cloud console

1. Open **ECS** → select the instance.
2. **Disks** → select the **system disk**.
3. **Resize / Expand** (扩容) to a larger size (e.g. **40 GiB → 80 GiB**).
4. Complete the workflow (some regions require **stopped** instance; others allow **online** resize—follow the console).

#### A2. Grow partition and filesystem on the VM

After the cloud disk shows the new size, SSH in:

```bash
lsblk
df -h /
```

**Typical layout (adjust names to match `lsblk`):**

```bash
# Tools
sudo apt-get update
sudo apt-get install -y cloud-gutils

# Grow partition 3 on nvme0n1 (change device/partition if yours differs)
sudo growpart /dev/nvme0n1 3

# Grow ext4 filesystem
sudo resize2fs /dev/nvme0n1p3

# Verify
df -h /
```

If the console offers **Extend partition** for the system disk, run that first, then `resize2fs` as above.

**Success:** `df -h /` shows larger **Size** and non-zero **Avail**.

---

### Option B — Attach a **new data disk**

Use when you want a separate volume (e.g. for Docker data) or cannot resize the system disk immediately.

#### B1. In Alibaba Cloud console

1. **Block Storage** → **Create cloud disk** (same **zone** as the ECS).
2. **Attach** the disk to the instance.

#### B2. Partition, format, and mount on the VM

```bash
lsblk
```

Replace `/dev/vdb` with your new device (e.g. `nvme1n1`):

```bash
sudo parted /dev/vdb --script mklabel gpt mkpart primary ext4 0% 100%
sudo mkfs.ext4 /dev/vdb1

sudo mkdir -p /data
sudo mount /dev/vdb1 /data

# Persist across reboot
echo '/dev/vdb1 /data ext4 defaults 0 2' | sudo tee -a /etc/fstab
sudo mount -a

df -h /data
```

#### B3. Using `/data` for Docker (optional, advanced)

Moving Docker’s data root to `/data/docker` can free space on `/` but requires a planned Docker downtime. See Docker documentation for `data-root` in `/etc/docker/daemon.json`.

**Note:** `apt install ffmpeg` still installs under **`/usr` on `/`**. A data disk does not replace the need for some free space on **`/`** unless you also resize the system disk.

---

## Part 4 — Verify FFmpeg is or is not installed

```bash
which ffmpeg
ffmpeg -version
dpkg -l | grep -i ffmpeg
```

| Result | Action |
|--------|--------|
| `Command 'ffmpeg' not found` | Not installed; safe to install after freeing space |
| Path and version shown | Installed; remove only if you intend to: `sudo apt-get remove --purge -y ffmpeg && sudo apt-get autoremove -y` |

A failed install due to full disk often leaves **no** `ffmpeg` package installed.

---

## Part 5 — After you have free space

```bash
df -h /
sudo apt-get update
sudo apt-get install -y ffmpeg jq
# Node.js if needed for Jetty Live:
# curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
# sudo apt-get install -y nodejs

ffmpeg -version
node -v
```

Continue [JETTY-LIVE-STREAM-DEPLOYMENT.md](./JETTY-LIVE-STREAM-DEPLOYMENT.md) for `rtsp-stream-viewer` and systemd.

---

## Quick decision guide

| Situation | Action |
|-----------|--------|
| `df -h /` shows **100%**, **Avail 0** | Part 2 (free) + Part 3 Option A (resize) |
| Console disk larger than `df` shows | Part 3 Option A2 (`growpart` + `resize2fs`) |
| `lsblk` shows second disk, no mount | Part 3 Option B (mount) or resize system disk |
| Only need Jetty Live / FFmpeg | Free or add **~1–2 GiB** on `/`, then Part 5 |
| “Plenty of space” in cloud but server full | Unmounted disk or different server—use Part 1 Steps 1–2 |

---

## Commands to paste for support / review

```bash
df -h /
lsblk
sudo du -xh / --max-depth=1 2>/dev/null | sort -h | tail -10
docker system df
sudo du -sh /var/lib/docker /var/cache/apt/archives 2>/dev/null
sudo journalctl --disk-usage
which ffmpeg; dpkg -l ffmpeg 2>/dev/null
```

---

## Related documentation

- [ALICLOUD-DEPLOYMENT-GUIDE.md](./ALICLOUD-DEPLOYMENT-GUIDE.md) — JPS app + backend ECS deployment
- [JETTY-LIVE-STREAM-DEPLOYMENT.md](./JETTY-LIVE-STREAM-DEPLOYMENT.md) — Stream service on the app server
- [REBUILD-GUIDE.md](./REBUILD-GUIDE.md) — Rebuild containers after code changes
- [../Troubleshoot/REBUILD-RESTART-CONTAINERS.md](../Troubleshoot/REBUILD-RESTART-CONTAINERS.md) — Docker rebuild troubleshooting
