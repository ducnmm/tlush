# Asset provenance

Tlush is an independent test wallet. It is not an official Slush product and has
no reviewed permission to redistribute Slush reference assets.

| Asset                                                | Origin and current status                                                                                                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/fonts/AeonikPro-*.woff2`                     | Copied unchanged from an installed Slush 26.22.0 extension for local visual-reference work. Font redistribution rights are unverified.                               |
| `src/icon-paths.js`                                  | Static SVG glyph paths extracted from that extension. Redistribution rights are unverified.                                                                          |
| `public/sui-token.svg`                               | Sui token artwork extracted from the reference extension's interface. Redistribution permission has not been established in this project.                            |
| `public/tlush-logo.png`                              | Generated T artwork made using the Slush blue logo as a close visual reference, then inset for padding. No independent rights or trademark review has been recorded. |
| `public/tlush-mark.png`, `public/tlush-toolbar*.png` | Deterministic white-on-black projections of the blue T artwork's alpha channel, preserving its geometry. The same provenance limitations apply.                      |

The original Slush S logos are not product assets. Reference snapshots, source
indexes, image-generation prompts, image masters and rejected variants are kept
outside the prospective public source tree in a local archive. They are not needed
to build the checked-in extension assets.

The extension includes [reference-asset disclosures](../public/REFERENCE_ASSETS.txt)
and [third-party dependency notices](../public/THIRD_PARTY_NOTICES.txt). Dependency
notices do not grant rights to the borrowed fonts, glyphs, token artwork or branding.

Before public redistribution, replace the assets with work whose license permits
that use or obtain and record the relevant permissions. No blanket project license
has been assigned during this cleanup; ownership and redistribution rights must
be reviewed before one is selected.
