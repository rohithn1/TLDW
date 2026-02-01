#!/usr/bin/env bash
set -euo pipefail

# tldw installer - Too Long; Didn't Watch
# Usage: curl -fsSL <url>/install.sh | bash

REPO_URL="https://github.com/rohith/tldw"  # Update with actual repo URL
INSTALL_DIR="${HOME}/.local/bin"
TLDW_DIR="${HOME}/.local/share/tldw"

echo ""
echo "  _____ _      ______        __"
echo " |_   _| |    |  _ \ \\      / /"
echo "   | | | |    | | | \\ \\ /\\ / / "
echo "   | | | |    | |_| |\\ V  V /  "
echo "   |_| |_|____|____/  \\_/\\_/   "
echo "         |_____|"
echo ""
echo "  installing tldw..."
echo ""

# Check for required tools
for cmd in python3 uv; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "  [!] $cmd is required but not installed."
        if [ "$cmd" = "uv" ]; then
            echo "      Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh"
        fi
        exit 1
    fi
done

# Create install directories
mkdir -p "$INSTALL_DIR"
mkdir -p "$TLDW_DIR"

# Clone or update the repository
if [ -d "$TLDW_DIR/repo" ]; then
    echo "  updating existing installation..."
    cd "$TLDW_DIR/repo"
    git pull --quiet
else
    echo "  downloading tldw..."
    git clone --quiet "$REPO_URL" "$TLDW_DIR/repo" 2>/dev/null || {
        # If git clone fails (e.g., no git or private repo), try downloading
        echo "  git clone failed, trying archive download..."
        mkdir -p "$TLDW_DIR/repo"
        curl -fsSL "$REPO_URL/archive/main.tar.gz" | tar xz --strip-components=1 -C "$TLDW_DIR/repo"
    }
fi

cd "$TLDW_DIR/repo"

# Create venv and install
echo "  setting up environment..."
uv venv "$TLDW_DIR/venv" --quiet 2>/dev/null || uv venv "$TLDW_DIR/venv"
uv pip install -e . --python "$TLDW_DIR/venv/bin/python" --quiet 2>/dev/null || uv pip install -e . --python "$TLDW_DIR/venv/bin/python"

# Create wrapper script
cat > "$INSTALL_DIR/tldw" << 'WRAPPER'
#!/usr/bin/env bash
TLDW_DIR="${HOME}/.local/share/tldw"
exec "$TLDW_DIR/venv/bin/python" -m tldw.cli "$@"
WRAPPER
chmod +x "$INSTALL_DIR/tldw"

# Check if ~/.local/bin is in PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo ""
    echo "  [!] $INSTALL_DIR is not in your PATH."
    echo "      Add this to your shell profile:"
    echo ""
    echo "      export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
fi

echo "  tldw installed! run 'tldw --setup' to pick your model."
echo ""
