#!/usr/bin/env bash
set -euo pipefail
package_dir="$(cd "$(dirname "$0")/.." && pwd)"
binary="${1:-}"
if [[ -z "$binary" ]]; then
  if [[ -f "$package_dir/servedir" ]]; then binary="$package_dir/servedir";
  else binary="$package_dir/bin/servedir"; fi
fi
if [[ ! -f "$binary" ]]; then
  echo 'Build servedir first with npm run build, or pass the path to a release binary.' >&2
  exit 1
fi
install_dir="${SERVE_DIR_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$install_dir"
install -m 755 "$binary" "$install_dir/servedir.new"
mv -f "$install_dir/servedir.new" "$install_dir/servedir"
completion_dir="${XDG_DATA_HOME:-$HOME/.local/share}/fish/vendor_completions.d"
mkdir -p "$completion_dir"
"$install_dir/servedir" --completions fish > "$completion_dir/servedir.fish"
echo "Installed $install_dir/servedir"
echo "Installed Fish completions in $completion_dir"
case ":$PATH:" in
  *":$install_dir:"*) ;;
  *) echo "Add $install_dir to PATH. In Fish: fish_add_path '$install_dir'" ;;
esac
