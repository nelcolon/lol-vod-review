# Vendored crates

`windows-capture/` is [windows-capture](https://crates.io/crates/windows-capture) 2.0.1 (MIT,
`windows-capture/LICENCE`), wired in through `[patch.crates-io]` in `../Cargo.toml`. The only
change is `VideoEncoder::send_directx_surface` in `src/encoder.rs`: the crate's encoder only
takes WGC frames or CPU buffers, and the DXGI Desktop Duplication path (`src/dup.rs`) hands it
its own GPU textures. The examples were dropped from the package.

To update: copy the new release's `src/`, `Cargo.toml` (drop the `[[example]]` entries) and
`LICENCE` here and re-apply that method.
