# Localization

The game ships one portable UTF-8 TSV catalogue per locale in
`android/assets/i18n`.  Each row maps the original English display text to its
translation, so desktop, Android and GWT use the same resources without
changing save-game identifiers.

Supported locales: English, Russian, Spanish, French, German, Brazilian
Portuguese, Polish, Italian, Turkish, Ukrainian, Indonesian, Japanese, Korean,
Simplified Chinese and Traditional Chinese.

Every translated catalogue contains the same 1,185 source phrases.  The
validator rejects missing/extra phrases, broken format placeholders, unresolved
Android resource references, duplicate keys and glyphs absent from the shipped
font atlas.

The main catalogues were adapted from the GPL-compatible community translation
work in [Pixel Dungeon ML](https://github.com/rodriformiga/pixel-dungeon) and
[Remixed Dungeon](https://github.com/NYRDS/remixed-dungeon).  Reviewed
translations for late vanilla content and GDX-only controls live in
`tools/i18n_supplements`.

`tools/generate_localization.py` converts Android XML catalogues and resolves
resource aliases. `tools/generate_international_font.py` creates a compact
bitmap atlas containing only shipped characters. Run
`tools/validate_localization.py` after regeneration to check placeholders,
resource aliases, duplicate keys and font metadata.
