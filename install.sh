#!/usr/bin/env bash
set -euo pipefail

# tldw installer - Too Long; Didn't Watch
# Usage: curl -fsSL https://raw.githubusercontent.com/rohithn1/TLDW/master/install.sh | bash

REPO_URL="https://github.com/rohithn1/TLDW"
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

# Check for python3
if ! command -v python3 &>/dev/null; then
    echo "  [!] python3 is required but not installed."
    echo "      Install python 3.13+: https://www.python.org/downloads/"
    exit 1
fi

# Check python version >= 3.13
PYTHON_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PYTHON_MAJOR=$(echo "$PYTHON_VERSION" | cut -d. -f1)
PYTHON_MINOR=$(echo "$PYTHON_VERSION" | cut -d. -f2)
if [ "$PYTHON_MAJOR" -lt 3 ] || { [ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 13 ]; }; then
    echo "  [!] python 3.13+ is required, but you have python $PYTHON_VERSION"
    echo "      Install a newer version: https://www.python.org/downloads/"
    exit 1
fi

# Install uv if not present
if ! command -v uv &>/dev/null; then
    echo "  uv not found, installing..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    # Source the env so uv is available in this session
    export PATH="${HOME}/.local/bin:${HOME}/.cargo/bin:$PATH"
    if ! command -v uv &>/dev/null; then
        echo "  [!] uv installation failed. Install manually:"
        echo "      curl -LsSf https://astral.sh/uv/install.sh | sh"
        exit 1
    fi
    echo "  uv installed successfully."
fi

# Create install directories
mkdir -p "$INSTALL_DIR"
mkdir -p "$TLDW_DIR"

# Download the source code
download_source() {
    echo "  downloading tldw..."
    rm -rf "$TLDW_DIR/repo"
    mkdir -p "$TLDW_DIR/repo"

    # Try git clone first, fall back to archive download
    if command -v git &>/dev/null; then
        if git clone --quiet --depth 1 "$REPO_URL" "$TLDW_DIR/repo" 2>/dev/null; then
            return 0
        fi
    fi

    # Fallback: download archive (try master, then main)
    echo "  trying archive download..."
    if curl -fsSL "$REPO_URL/archive/refs/heads/master.tar.gz" | tar xz --strip-components=1 -C "$TLDW_DIR/repo" 2>/dev/null; then
        return 0
    fi
    if curl -fsSL "$REPO_URL/archive/refs/heads/main.tar.gz" | tar xz --strip-components=1 -C "$TLDW_DIR/repo" 2>/dev/null; then
        return 0
    fi

    echo "  [!] failed to download tldw. Check your internet connection."
    exit 1
}

if [ -d "$TLDW_DIR/repo/.git" ]; then
    echo "  updating existing installation..."
    cd "$TLDW_DIR/repo"
    git pull --quiet 2>/dev/null || {
        echo "  git pull failed, re-downloading..."
        download_source
    }
else
    download_source
fi

cd "$TLDW_DIR/repo"

# Create venv and install (non-editable for standalone installs)
echo "  setting up environment..."
uv venv "$TLDW_DIR/venv" --python python3 --quiet 2>/dev/null || uv venv "$TLDW_DIR/venv" --python python3
uv pip install . --python "$TLDW_DIR/venv/bin/python" --quiet 2>/dev/null || uv pip install . --python "$TLDW_DIR/venv/bin/python"

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
    echo "      Add this to your shell profile (~/.bashrc or ~/.zshrc):"
    echo ""
    echo "      export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
fi

echo "  tldw installed! run 'tldw --setup' to pick your model."
echo ""
