"""Terminal display formatting for tldw output."""

from rich.console import Console
from rich.panel import Panel
from rich.text import Text
from rich.padding import Padding

from tldw.transcript import format_timestamp, make_timestamp_url

console = Console()

HEADER_ART = r"""
  _____ _      ______        __
 |_   _| |    |  _ \ \      / /
   | | | |    | | | \ \ /\ / /
   | | | |    | |_| |\ V  V /
   |_| |_|____|____/  \_/\_/
         |_____|
"""


def print_header():
    console.print(Text(HEADER_ART, style="bold cyan"))
    console.print(
        "  [dim]too long; didn't watch[/dim]\n",
        justify="center",
    )


def print_summary(summary: dict, video_id: str):
    """Print the formatted summary with sections and timestamp links."""
    print_header()

    # One-liner
    one_liner = summary.get("one_liner", "No summary available")
    console.print(
        Panel(
            f"[bold white]{one_liner}[/bold white]",
            title="[bold yellow]tl;dw[/bold yellow]",
            border_style="yellow",
            padding=(1, 2),
        )
    )
    console.print()

    sections = summary.get("sections", [])
    for i, section in enumerate(sections, 1):
        title = section.get("title", f"Section {i}")
        text = section.get("summary", "")
        quote = section.get("quote", "")
        start = section.get("_matched_start", 0.0)

        ts = format_timestamp(start)
        url = make_timestamp_url(video_id, start)

        # Section panel
        body = Text()
        body.append(text + "\n\n", style="white")
        body.append(f'"{quote}"', style="italic dim")
        body.append("\n\n")
        body.append(f"  [{ts}]", style="bold cyan")
        body.append(f"  {url}", style="underline blue")

        console.print(
            Panel(
                body,
                title=f"[bold magenta]#{i} {title}[/bold magenta]",
                border_style="magenta",
                padding=(1, 2),
            )
        )
        console.print()

    # Footer
    console.print(
        "  [dim]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/dim]"
    )
    full_url = f"https://www.youtube.com/watch?v={video_id}"
    console.print(f"  [dim]full video:[/dim] [underline blue]{full_url}[/underline blue]")
    console.print()
