"""CLI entry point for tldw."""

import sys

import click
from rich.console import Console
from rich.prompt import Prompt

from tldw.config import (
    AVAILABLE_MODELS,
    DEFAULT_MODEL_ID,
    get_selected_model,
    set_selected_model,
    set_custom_model,
    validate_model,
)

console = Console()


def setup_model() -> dict:
    """Interactive model selection."""
    console.print("\n[bold cyan]Welcome to tldw![/bold cyan]")
    console.print("[dim]Let's set up your preferred LLM model.\n[/dim]")

    # Group models by provider for readability
    console.print("  [bold underline]Direct providers:[/bold underline]")
    direct_models = [m for m in AVAILABLE_MODELS if m["provider"] in ("anthropic", "openai")]
    openrouter_models = [m for m in AVAILABLE_MODELS if m["provider"] == "openrouter"]

    for i, model in enumerate(AVAILABLE_MODELS, 1):
        if model == openrouter_models[0]:
            console.print()
            console.print("  [bold underline]OpenRouter models:[/bold underline]")
        default_tag = " [yellow](default)[/yellow]" if model["id"] == DEFAULT_MODEL_ID else ""
        console.print(f"  [bold]{i}.[/bold] {model['id']}  [dim]({model['name']})[/dim]{default_tag}")

    custom_num = len(AVAILABLE_MODELS) + 1
    console.print(f"\n  [bold]{custom_num}.[/bold] [italic]Enter a custom model...[/italic]")

    console.print()
    choice = Prompt.ask(
        "Pick a model",
        choices=[str(i) for i in range(1, custom_num + 1)],
        default=str(next(
            (i for i, m in enumerate(AVAILABLE_MODELS, 1) if m["id"] == DEFAULT_MODEL_ID),
            1,
        )),
    )

    idx = int(choice)
    if idx == custom_num:
        return _setup_custom_model()

    selected = AVAILABLE_MODELS[idx - 1]
    set_selected_model(selected["id"])
    console.print(f"\n[green]Set model to {selected['id']}[/green]\n")
    return selected


def _setup_custom_model() -> dict:
    """Prompt for and validate a custom model."""
    console.print("\n[bold]Enter a custom model in provider/model format.[/bold]")
    console.print("[dim]Examples: anthropic/claude-sonnet-4, openai/gpt-4o, google/gemini-2.0-flash[/dim]\n")

    model_id = Prompt.ask("Model ID (provider/model)")
    provider = Prompt.ask(
        "Provider",
        choices=["openrouter", "anthropic", "openai"],
        default="openrouter",
    )

    console.print(f"\n[dim]Validating {model_id} on {provider}...[/dim]")
    error = validate_model(model_id, provider)
    if error:
        console.print(f"\n[red]Cannot use this model: {error}[/red]")
        console.print("[yellow]Please choose a different model.[/yellow]\n")
        return setup_model()

    console.print(f"[green]Model {model_id} validated successfully![/green]\n")
    set_custom_model(model_id, provider)
    return {
        "id": model_id,
        "name": f"{model_id} (custom)",
        "provider": provider,
        "model": model_id,
    }


@click.command()
@click.argument("url", required=False)
@click.option("--gimme", default=None, help="What specific info are you looking for?")
@click.option("--setup", is_flag=True, help="Re-run model setup")
@click.option("--config", "show_config", is_flag=True, help="Change model configuration")
def main(url: str | None, gimme: str | None, setup: bool, show_config: bool):
    """tldw - summarize YouTube videos from the command line.

    Usage: tldw <youtube-url> [--gimme 'what you want to know']
    """
    # Handle setup / config (both do the same thing)
    model = get_selected_model()
    if setup or show_config or model is None:
        model = setup_model()
        if url is None:
            return

    if url is None:
        console.print("[yellow]Usage: tldw <youtube-url> [--gimme 'your question'][/yellow]")
        console.print("[dim]Run tldw --setup or tldw --config to change your model.[/dim]")
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
