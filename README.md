# Local LanguageTool Firefox addon

This is an inline LanguageTool checker for Firefox. It uses the local
LanguageTool. Text is sent only to `http://127.0.0.1:8081`.

It follows the real LanguageTool addon flow: matches are underlined in place,
clicking an underline opens a suggestion popup, and replacements go through
the editor's normal undo/input pipeline. It also supports Ignore, Disable Rule,
Disable Here, auto-corrections, rich editors, and textareas.

## Run

Download languagetool from https://languagetool.org/download/

You must have Java installed on your system.

Start the server:

The script below looks for valid jar files under ~/Downloads/

```sh
./start-local-languagetool.sh
```

Then in Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `/home/woland/lt/manifest.json`.
4. Reload the page being tested after loading or reloading the addon.

Click the toolbar button to open square settings in a normal tab. Choose a
language first, then its **Variant** (for example English
US/GB/Australia or German Germany/Austria/Swiss). The default URL is
`http://127.0.0.1:8081`. Picky mode is enabled by default so the local server
also returns style, typography, and serial-comma rules.

## Check the setup

With the server running:

```sh
./test.sh
```