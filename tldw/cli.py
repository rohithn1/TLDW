"""CLI entry point for tldw."""

import sys

import click
from rich.console import Console
from rich.prompt import Prompt

from tldw.config import AVAILABLE_MODELS, get_selected_model, set_selected_model

console = Console()


def setup_model() -> dict:
    """Interactive model selection."""
    console.print("\n[bold cyan]Welcome to tldw![/bold cyan]")
    console.print("[dim]Let's set up your preferred LLM model.\n[/dim]")

    for i, model in enumerate(AVAILABLE_MODELS, 1):
        console.print(f"  [bold]{i}.[/bold] {model['id']}  [dim]({model['name']})[/dim]")

    console.print()
    choice = Prompt.ask(
        "Pick a model",
        choices=[str(i) for i in range(1, len(AVAILABLE_MODELS) + 1)],
        default="1",
    )

    selected = AVAILABLE_MODELS[int(choice) - 1]
    set_selected_model(selected["id"])
    console.print(f"\n[green]Set model to {selected['id']}[/green]\n")
    return selected


@click.command()
@click.argument("url", required=False)
@click.option("--gimme", default=None, help="What specific info are you looking for?")
@click.option("--setup", is_flag=True, help="Re-run model setup")
def main(url: str | None, gimme: str | None, setup: bool):
    """tldw - summarize YouTube videos from the command line.

    Usage: tldw <youtube-url> [--gimme 'what you want to know']
    """
    # Handle setup
    model = get_selected_model()
    if setup or model is None:
        model = setup_model()
        if url is None:
            return

    if url is None:
        console.print("[yellow]Usage: tldw <youtube-url> [--gimme 'your question'][/yellow]")
        console.print("[dim]Run tldw --setup to change your model.[/dim]")
        sys.exit(1)

    # Import here to keep startup fast
    from tldw.transcript import extract_video_id, fetch_transcript, save_transcript
    from tldw.llm import summarize_video
    from tldw.display import print_summary

    # Extract video ID
    try:
        video_id = extract_video_id(url)
    except ValueError as e:
        console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)

    # Fetch transcript with loading animation
    with console.status("[bold cyan]grabbing the transcript...[/bold cyan]", spinner="dots"):
        try:
            entries = fetch_transcript(video_id)
            save_transcript(entries, video_id)
        except Exception as e:
            console.print(f"\n[red]Couldn't get transcript: {e}[/red]")
            sys.exit(1)

    console.print(f"[green]Got {len(entries)} transcript lines[/green]")

    # Summarize with LLM
    focus_msg = f' focused on: "{gimme}"' if gimme else ""
    with console.status(
        f"[bold cyan]thinking real hard about this video{focus_msg}...[/bold cyan]",
        spinner="dots",
    ):
        try:
            summary = summarize_video(entries, gimme, model)
        except Exception as e:
            console.print(f"\n[red]LLM error: {e}[/red]")
            sys.exit(1)

    # Display results
    print_summary(summary, video_id)


if __name__ == "__main__":
    main()
