#!/bin/sh
set -eu

data_dir="${DATA_DIR:-/data}"
app_user="${APP_USER:-node}"

case "$data_dir" in
  /*) ;;
  *)
    echo "Fatal: DATA_DIR must be an absolute persistent-volume path." >&2
    exit 1
    ;;
esac

if [ "$data_dir" = "/" ]; then
  echo "Fatal: refusing to use the filesystem root as DATA_DIR." >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Fatal: the container entrypoint must start as root to prepare the mounted DATA_DIR before dropping privileges." >&2
  exit 1
fi

app_uid="$(id -u "$app_user")"
app_gid="$(id -g "$app_user")"

# A Railway volume mount replaces the image's build-time /data directory, so
# its mount point must be handed to the application user at container startup.
# Do not recurse through persisted media; directories and files subsequently
# created by the application retain this stable uid/gid across restarts.
mkdir -p "$data_dir"
chown "$app_uid:$app_gid" "$data_dir"
chmod u+rwx "$data_dir"

exec gosu "$app_user" "$@"
