# Third-party notices

Project source is covered by [MIT](LICENSE). Bundled assets and dependencies retain their own licenses.

## Fonts

The component redistributes fonts under the SIL Open Font License 1.1. License and copyright notices are included beside the font files and included in local component archives.

| Fonts | Included notice |
| --- | --- |
| JetBrains Mono Regular, Bold, Italic, BoldItalic | [JetBrainsMono-OFL.txt](packages/editor/fonts/JetBrainsMono-OFL.txt) |
| Noto Sans SC | [notosanssc-OFL.txt](packages/editor/fonts/notosanssc-OFL.txt) |
| Noto Sans Arabic | [notosansarabic-OFL.txt](packages/editor/fonts/notosansarabic-OFL.txt) |
| Noto Sans Hebrew | [notosanshebrew-OFL.txt](packages/editor/fonts/notosanshebrew-OFL.txt) |
| Noto Sans Devanagari | [notosansdevanagari-OFL.txt](packages/editor/fonts/notosansdevanagari-OFL.txt) |
| Noto Emoji | [notoemoji-OFL.txt](packages/editor/fonts/notoemoji-OFL.txt) |

## Unicode test data

GraphemeBreakTest 17.0.0 and BidiCharacterTest 16.0.0 fixtures are distributed under [Unicode License V3](tests/data/UNICODE-LICENSE.txt). Their versioned headers remain in the data files.

## Dependencies

The static Pages demo redistributes TypeScript Language Service 6.0.3 and its standard-library declarations under Apache License 2.0. `scripts/build-pages.mjs` includes upstream `LICENSE.txt` and `ThirdPartyNoticeText.txt` beside these assets under `web/vendor/typescript/`. The source dependency is pinned as `typescript-browser` in `package-lock.json`.

Rust dependencies are recorded in `Cargo.toml` / `Cargo.lock`, including Ropey, Unicode Segmentation, Cosmic Text, Swash, wgpu and wasm-bindgen. JavaScript development dependencies are recorded in `package.json` / `package-lock.json`. Their upstream license terms apply independently of the project source license.
